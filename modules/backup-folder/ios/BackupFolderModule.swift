import CommonCrypto
import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

// Mood's local native module (V1_PLAN modules/backup-folder): PBKDF2 for encrypted backups (ported from
// warranty-wallet's receipt-ocr module, D21), the Android-only window privacy flag, and (P8) the automatic-backup
// folder: a folder picked once in the system picker (iCloud Drive, On My iPhone, Drive, Dropbox ...) is kept as a
// security-scoped bookmark, so the app can write into it again after a restart (D17). Android does the folder part
// with expo-file-system's SAF picker (persistable tree permission) — see src/lib/backup-folder.ts.
public class BackupFolderModule: Module {
  private var picking: FolderPickDelegate?

  public func definition() -> ModuleDefinition {
    Name("BackupFolder")

    // Android only (FLAG_SECURE while the lock is on). iOS hides the app-switcher snapshot with the lock cover.
    AsyncFunction("setSecureWindow") { (_: Bool) -> Bool in
      return false
    }

    // PBKDF2-HMAC-SHA256 for the backup password: native, so 600 000 rounds take well under a second.
    // Salt and result are hex strings. Runs off the main thread (AsyncFunction).
    AsyncFunction("pbkdf2Sha256") { (password: String, saltHex: String, iterations: Int, keyBytes: Int) -> String in
      let salt = Self.dataFromHex(saltHex)
      let pw = Array(password.utf8)
      var derived = [UInt8](repeating: 0, count: keyBytes)
      let status = salt.withUnsafeBytes { saltPtr in
        CCKeyDerivationPBKDF(
          CCPBKDFAlgorithm(kCCPBKDF2),
          pw.map { Int8(bitPattern: $0) }, pw.count,
          saltPtr.bindMemory(to: UInt8.self).baseAddress, salt.count,
          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
          UInt32(iterations),
          &derived, keyBytes)
      }
      guard status == kCCSuccess else { throw Pbkdf2Exception() }
      return derived.map { String(format: "%02x", $0) }.joined()
    }

    // Folder picker → {id: base64 bookmark, name} or nil when cancelled.
    AsyncFunction("pickFolder") { (promise: Promise) in
      guard self.picking == nil else {
        promise.reject(FolderException("busy", "a folder picker is already open"))
        return
      }
      guard let vc = self.appContext?.utilities?.currentViewController() else {
        promise.reject(FolderException("no-view", "no view controller"))
        return
      }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
      picker.allowsMultipleSelection = false
      let delegate = FolderPickDelegate { [weak self] url in
        self?.picking = nil
        guard let url = url else {
          promise.resolve(nil)
          return
        }
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }
        do {
          let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
          promise.resolve(["id": data.base64EncodedString(), "name": url.lastPathComponent])
        } catch {
          promise.reject(FolderException("bookmark", error.localizedDescription))
        }
      }
      self.picking = delegate
      picker.delegate = delegate
      picker.presentationController?.delegate = delegate
      vc.present(picker, animated: true)
    }.runOnQueue(.main)

    // {ok, name, id?: refreshed bookmark when the old one went stale, error?}
    AsyncFunction("checkFolder") { (id: String) -> [String: Any?] in
      do {
        return try Self.withFolder(id) { url, refreshed in
          var isDir: ObjCBool = false
          guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else {
            throw FolderException("missing", "folder not found")
          }
          return ["ok": true, "name": url.lastPathComponent, "id": refreshed]
        }
      } catch let e as FolderException {
        return ["ok": false, "error": e.kind, "detail": e.detail]
      } catch {
        return ["ok": false, "error": "access", "detail": error.localizedDescription]
      }
    }

    // Copies the file at `sourcePath` (app cache) into the folder as `name`, replacing a file of that name.
    AsyncFunction("writeFile") { (id: String, sourcePath: String, name: String) -> [String: Any?] in
      try Self.checkName(name)
      return try Self.withFolder(id) { url, refreshed in
        let source = URL(fileURLWithPath: sourcePath.hasPrefix("file://") ? URL(string: sourcePath)!.path : sourcePath)
        let target = url.appendingPathComponent(name, isDirectory: false)
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { dest in
          do {
            let data = try Data(contentsOf: source)
            try data.write(to: dest, options: .atomic)
          } catch {
            writeError = error
          }
        }
        if let e = coordError ?? (writeError as NSError?) { throw FolderException(Self.code(for: e), e.localizedDescription) }
        return ["ok": true, "id": refreshed]
      }
    }

    // [{name, size, modifiedMs}] of the files directly in the folder.
    AsyncFunction("listFiles") { (id: String) -> [[String: Any]] in
      return try Self.withFolder(id) { url, _ in
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
        let items = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
        return items.compactMap { item in
          let v = try? item.resourceValues(forKeys: Set(keys))
          if v?.isRegularFile == false { return nil }
          return ["name": item.lastPathComponent, "size": v?.fileSize ?? 0, "modifiedMs": (v?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000]
        }
      }
    }

    // Deletes one of the app's own automatic backups (only `mood-auto-*.moodbackup` names, SPEC rotation rule).
    AsyncFunction("deleteOwnFile") { (id: String, name: String) -> Bool in
      try Self.checkName(name)
      guard name.hasPrefix("mood-auto-"), name.hasSuffix(".moodbackup") else {
        throw FolderException("not-own", "only mood-auto-*.moodbackup files are deleted")
      }
      return try Self.withFolder(id) { url, _ in
        let target = url.appendingPathComponent(name, isDirectory: false)
        guard FileManager.default.fileExists(atPath: target.path) else { return false }
        var coordError: NSError?
        var deleteError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forDeleting, error: &coordError) { dest in
          do { try FileManager.default.removeItem(at: dest) } catch { deleteError = error }
        }
        if let e = coordError ?? (deleteError as NSError?) { throw FolderException(Self.code(for: e), e.localizedDescription) }
        return true
      }
    }

    // A few more seconds of run time after the app went to the background (the automatic backup runs then).
    Function("beginBackgroundWork") { () -> Int in
      var task: UIBackgroundTaskIdentifier = .invalid
      task = UIApplication.shared.beginBackgroundTask(withName: "mood-auto-backup") {
        UIApplication.shared.endBackgroundTask(task)
      }
      return task.rawValue
    }

    Function("endBackgroundWork") { (id: Int) in
      let task = UIBackgroundTaskIdentifier(rawValue: id)
      if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }
  }

  /// Resolves the bookmark, starts the security scope for `body`, and hands back a fresh bookmark if it was stale.
  static func withFolder<T>(_ id: String, _ body: (URL, String?) throws -> T) throws -> T {
    guard let data = Data(base64Encoded: id) else { throw FolderException("bad-id", "bookmark is not base64") }
    var stale = false
    let url: URL
    do {
      url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    } catch {
      throw FolderException("missing", error.localizedDescription)
    }
    let started = url.startAccessingSecurityScopedResource()
    defer { if started { url.stopAccessingSecurityScopedResource() } }
    if !started { throw FolderException("access", "no access to the folder") }
    var refreshed: String? = nil
    if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
      refreshed = fresh.base64EncodedString()
    }
    return try body(url, refreshed)
  }

  static func checkName(_ name: String) throws {
    if name.isEmpty || name.contains("/") || name.hasPrefix(".") { throw FolderException("bad-name", name) }
  }

  static func code(for e: NSError) -> String {
    if e.domain == NSCocoaErrorDomain && (e.code == NSFileWriteOutOfSpaceError) { return "full" }
    if e.domain == NSPOSIXErrorDomain && e.code == Int(ENOSPC) { return "full" }
    if e.domain == NSCocoaErrorDomain && (e.code == NSFileNoSuchFileError || e.code == NSFileReadNoSuchFileError) { return "missing" }
    if e.domain == NSCocoaErrorDomain && (e.code == NSFileWriteNoPermissionError || e.code == NSFileReadNoPermissionError) { return "access" }
    return "write"
  }

  static func dataFromHex(_ hex: String) -> Data {
    var data = Data()
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2, limitedBy: hex.endIndex) ?? hex.endIndex
      if let byte = UInt8(hex[index..<next], radix: 16) { data.append(byte) }
      index = next
    }
    return data
  }
}

final class FolderPickDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private var done: ((URL?) -> Void)?
  init(_ done: @escaping (URL?) -> Void) { self.done = done }
  private func finish(_ url: URL?) {
    let d = done
    done = nil
    d?(url)
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls.first) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish(nil) }
}

internal class Pbkdf2Exception: Exception {
  override var reason: String { "PBKDF2 failed" }
}

/// Error with a short machine code (JS maps it to a status line) and the system's detail.
internal class FolderException: Exception {
  let kind: String
  let detail: String
  init(_ kind: String, _ detail: String) {
    self.kind = kind
    self.detail = detail
    super.init()
  }
  override var reason: String { "\(kind): \(detail)" }
}
