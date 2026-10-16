// Manual backup and restore (SPEC "Import, export, backup", D43–D45, D56). The file is built and read in memory (D44).
// Restore: everything is checked first (container, checksums, snapshot), the photos are written, then ONE transaction
// replaces the journal (restoreSnapshot). Wrong password / damaged / newer → message, nothing changed.
import Constants from 'expo-constants';
import { File } from 'expo-file-system';

import { exportSnapshot, restoreSnapshot, snapshotPhotoFiles } from '@/db/backup-snapshot';
import type { Db } from '@/db/types';
import { backupFileName, buildBackupZip, isPhotoName, readBackupFile, sealBackup, type BackupManifest, type Snapshot } from '@/engine/backup-container';
import { expoBackupCrypto } from '@/lib/backup-crypto';
import { calendarToday } from '@/lib/clock';
import { cacheFile, writeBytes } from '@/lib/files';
import { photoFile, photosDir } from '@/lib/photos';

const appVersion = () => Constants.expoConfig?.version ?? '1.0.0';

export type BuiltBackup = { file: File; name: string; bytes: number; counts: BackupManifest['counts']; encrypted: boolean; ms: { snapshot: number; zip: number; seal: number } };

let lastBackup: File | null = null;
/** Dev: the file of the last backup made in this session (the restore flow picks it). */
export const lastBackupFile = () => lastBackup;

/** Builds a backup file in the app cache (`name` default: the manual `mood-YYYY-MM-DD.moodbackup`). */
export async function createBackup(db: Db, password: string | null, name: string = backupFileName(calendarToday(), false)): Promise<BuiltBackup> {
  let t0 = Date.now();
  const snapshot = await exportSnapshot(db);
  const tSnap = Date.now() - t0;
  const photos = [];
  for (const name of snapshotPhotoFiles(snapshot)) {
    const f = photoFile(name);
    if (isPhotoName(name) && f.exists) photos.push({ name, bytes: await f.bytes() });
  }
  t0 = Date.now();
  const createdAt = new Date().toISOString();
  const zip = buildBackupZip({ snapshot, photos, appVersion: appVersion(), createdAt });
  const tZip = Date.now() - t0;
  t0 = Date.now();
  const bytes = password ? await sealBackup(zip, { crypto: expoBackupCrypto, password, createdAt, appVersion: appVersion() }) : zip;
  const tSeal = Date.now() - t0;
  const file = cacheFile('backup', name);
  writeBytes(file, bytes);
  lastBackup = file;
  const counts = countsOf(snapshot, photos.length);
  return { file, name, bytes: bytes.length, counts, encrypted: !!password, ms: { snapshot: tSnap, zip: tZip, seal: tSeal } };
}

function countsOf(snapshot: Snapshot, photos: number): BackupManifest['counts'] {
  return {
    entries: snapshot.tables.entries?.rows.length ?? 0,
    photos,
    moods: snapshot.tables.moods?.rows.length ?? 0,
    activities: snapshot.tables.activities?.rows.length ?? 0,
  };
}

export type OpenedBackup = Awaited<ReturnType<typeof readBackupFile>>;

/** Reads and checks a backup file (throws BackupError: password-needed, wrong-password, damaged, newer-version …). */
export function openBackup(bytes: Uint8Array, password?: string): Promise<OpenedBackup> {
  return readBackupFile(bytes, { crypto: expoBackupCrypto, password });
}

/** Replaces the whole journal with the backup. Photos first (new files only add), then one transaction. */
export async function restoreBackup(db: Db, opened: OpenedBackup): Promise<{ entries: number; photos: number; ms: number }> {
  const t0 = Date.now();
  const dir = photosDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  for (const [name, bytes] of opened.photos) {
    if (!isPhotoName(name)) continue; // readBackupZip already refuses these (D56); belt and braces
    const f = photoFile(name);
    if (!f.exists) {
      f.create();
      f.write(bytes);
    }
  }
  const r = await restoreSnapshot(db, opened.snapshot);
  return { ...r, ms: Date.now() - t0 };
}
