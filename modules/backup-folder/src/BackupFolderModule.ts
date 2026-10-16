import { NativeModule, requireNativeModule } from 'expo';

export type FolderCheck = { ok: boolean; name?: string; id?: string | null; error?: string; detail?: string };
export type FolderFile = { name: string; size: number; modifiedMs: number };

// Local Expo module (V1_PLAN modules/backup-folder): iOS CommonCrypto + folder bookmarks, Android SecretKeyFactory /
// window flags. The folder functions exist on iOS only; Android uses expo-file-system's SAF directory (lib/backup-folder).
declare class BackupFolderModule extends NativeModule<{}> {
  /** PBKDF2-HMAC-SHA256; salt and result are hex strings; the password is hashed as UTF-8. */
  pbkdf2Sha256(password: string, saltHex: string, iterations: number, keyBytes: number): Promise<string>;
  /** Android: FLAG_SECURE on the app's window (true = applied). iOS: no-op, false. */
  setSecureWindow(on: boolean): Promise<boolean>;
  /** iOS: system folder picker; `id` = security-scoped bookmark (base64). null = cancelled. */
  pickFolder(): Promise<{ id: string; name: string } | null>;
  /** iOS: can the app still reach the folder? `id` set = refreshed bookmark to store. */
  checkFolder(id: string): Promise<FolderCheck>;
  /** iOS: copy a file from the app's cache into the folder (replaces a file of that name). */
  writeFile(id: string, sourcePath: string, name: string): Promise<{ ok: boolean; id?: string | null }>;
  /** iOS: files directly in the folder. */
  listFiles(id: string): Promise<FolderFile[]>;
  /** iOS: delete `mood-auto-*.moodbackup` only; false when it was not there. */
  deleteOwnFile(id: string, name: string): Promise<boolean>;
  /** Android: restart the app process (layout direction changes need it). iOS: not defined. */
  restartApp?(): boolean;
  /** iOS: background task while the automatic backup runs after the app left the screen (0 elsewhere). */
  beginBackgroundWork(): number;
  endBackgroundWork(id: number): void;
}

export default requireNativeModule<BackupFolderModule>('BackupFolder');
