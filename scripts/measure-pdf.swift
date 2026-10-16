// Independent re-read of an exported PDF with Apple's PDFKit (no project dependency): per page the MediaBox, the
// text's left/right/top/bottom edges in points and the font sizes used, so the print profiles (src/lib/print-html.ts)
// can be checked against the layout (16 mm = 45.35 pt margins, body 10.5 pt, title 16 pt).
// Usage: swift scripts/measure-pdf.swift <file.pdf> [...]
import Foundation
import PDFKit

for path in CommandLine.arguments.dropFirst() {
  guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { print("\(path): not a PDF"); continue }
  print("\(path): \(doc.pageCount) pages")
  for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let box = page.bounds(for: .mediaBox)
    var minX = CGFloat.infinity, maxX = -CGFloat.infinity, maxY = -CGFloat.infinity, minY = CGFloat.infinity
    let text = (page.string ?? "") as NSString
    for c in 0..<text.length {
      let ch = text.character(at: c)
      if ch == 32 || ch == 10 || ch == 13 || ch == 9 || ch == 160 { continue }
      let r = page.characterBounds(at: c)
      if r.width <= 0 || r.height <= 0 { continue }
      minX = min(minX, r.minX); maxX = max(maxX, r.maxX); maxY = max(maxY, r.maxY); minY = min(minY, r.minY)
    }
    var sizes: [Double: Int] = [:]
    if let attr = page.attributedString {
      attr.enumerateAttribute(.font, in: NSRange(location: 0, length: attr.length)) { value, range, _ in
        if let f = value as? NSFont { sizes[(Double(f.pointSize) * 10).rounded() / 10, default: 0] += range.length }
      }
    }
    let top = box.maxY - maxY, bottom = minY - box.minY, right = box.maxX - maxX
    let sizeText = sizes.sorted { $0.value > $1.value }.prefix(4).map { "\($0.key)pt×\($0.value)" }.joined(separator: " ")
    print(String(format: "  p%d box %.1fx%.1f  left %.1f right %.1f top %.1f bottom %.1f  fonts %@", i + 1, box.width, box.height, minX - box.minX, right, top, bottom, sizeText))
  }
}
