// The automatic-backup folder on both platforms (D17). The system picker is the consent; no permission dialog.
// - iOS: modules/backup-folder keeps a security-scoped bookmark (works again after a restart; refreshed when stale).
// - Android: expo-file-system's SAF tree picker, which takes the persistable read/write permission for the tree.
// Files are only ever CREATED under a new name (never overwritten) and only the app's own mood-auto-* files are deleted.
import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

import BackupFolder from '../../modules/backup-folder/src/BackupFolderModule';
import { errorCode, type AutoError } from '@/lib/auto-backup-plan';
import { withLockSuspended } from '@/lib/lock-controller';

export type Folder = { platform: 'ios' | 'android'; id: string; name: string };

export class FolderError extends Error {
  constructor(readonly code: AutoError, message: string) {
    super(message);
    this.name = 'FolderError';
  }
}

const fail = (e: unknown): never => {
  if (e instanceof FolderError) throw e;
  const message = e instanceof Error ? e.message : String(e);
  throw new FolderError(errorCode(message), message);
};

/** Readable name of an Android tree URI: "primary:Download/Mood" → "Download/Mood"; else the last path part. */
export function androidFolderName(uri: string): string {
  const m = /\/tree\/([^/]+)/.exec(uri);
  if (!m) return uri;
  const id = decodeURIComponent(m[1]);
  const path = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return path || id;
}

/** System folder picker. null = cancelled. */
export async function pickFolder(): Promise<Folder | null> {
  if (Platform.OS === 'ios') {
    const r = await withLockSuspended(() => BackupFolder.pickFolder());
    return r ? { platform: 'ios', id: r.id, name: r.name } : null;
  }
  try {
    const dir = await withLockSuspended(() => Directory.pickDirectoryAsync());
    return { platform: 'android', id: dir.uri, name: androidFolderName(dir.uri) };
  } catch (e) {
    if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

/** Throws FolderError when the folder cannot be reached; returns a refreshed folder when iOS renewed the bookmark. */
export async function checkFolder(folder: Folder): Promise<Folder | null> {
  if (folder.platform === 'ios') {
    const r = await BackupFolder.checkFolder(folder.id);
    if (!r.ok) throw new FolderError(errorCode(r.error ?? 'write'), r.detail ?? r.error ?? 'folder');
    return r.id ? { ...folder, id: r.id } : null;
  }
  let exists = false;
  try {
    exists = new Directory(folder.id).exists;
  } catch (e) {
    fail(e);
  }
  if (!exists) throw new FolderError('missing', 'folder not found or no access');
  return null;
}

/** Names of the files directly in the folder. */
export async function listFolder(folder: Folder): Promise<string[]> {
  try {
    if (folder.platform === 'ios') return (await BackupFolder.listFiles(folder.id)).map((f) => f.name);
    return new Directory(folder.id)
      .list()
      .filter((x): x is File => x instanceof File)
      .map((f) => f.name);
  } catch (e) {
    return fail(e);
  }
}

/** Copies `source` (a file in the app cache) into the folder as a NEW file `name`. */
export async function writeIntoFolder(folder: Folder, source: File, name: string): Promise<Folder | null> {
  try {
    if (folder.platform === 'ios') {
      const r = await BackupFolder.writeFile(folder.id, source.uri, name);
      return r.id ? { ...folder, id: r.id } : null;
    }
    const target = new Directory(folder.id).createFile(name, 'application/octet-stream');
    // Some providers append " (1)" or an extension; the name we record is the one the provider gave.
    target.write(await source.bytes());
    if (target.name !== name) throw new FolderError('write', `provider renamed ${name} to ${target.name}`);
    return null;
  } catch (e) {
    return fail(e);
  }
}

/** Deletes one of the app's own automatic backups (the caller checked it is one). */
export async function deleteFromFolder(folder: Folder, name: string): Promise<boolean> {
  try {
    if (folder.platform === 'ios') return await BackupFolder.deleteOwnFile(folder.id, name);
    const f = new Directory(folder.id).list().find((x): x is File => x instanceof File && x.name === name);
    if (!f) return false;
    f.delete();
    return true;
  } catch (e) {
    return fail(e);
  }
}

/** iOS: keep running a little after the app left the screen. */
export async function inBackgroundTime<T>(fn: () => Promise<T>): Promise<T> {
  const id = Platform.OS === 'ios' ? BackupFolder.beginBackgroundWork() : 0;
  try {
    return await fn();
  } finally {
    if (Platform.OS === 'ios') BackupFolder.endBackgroundWork(id);
  }
}
