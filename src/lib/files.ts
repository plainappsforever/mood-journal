// Share sheet and document picker glue (no permissions: the system UI is the consent). Dev builds can make the next
// pick return a prepared file, because Maestro cannot drive the system pickers reliably (print-cost D63 pattern).
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { withLockSuspended } from '@/lib/lock-controller';

export function cacheFile(dir: string, name: string): File {
  const d = new Directory(Paths.cache, dir);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return new File(d, name);
}

export function writeBytes(file: File, bytes: Uint8Array | string): void {
  if (file.exists) file.delete(); // our own cache file from an earlier export of the same name
  file.create();
  file.write(bytes);
}

export type ShareOutcome = 'shared' | 'unavailable';

/** The system share sheet for a file we just wrote ("Save to Files", AirDrop, mail …). */
export async function shareFile(file: File, mimeType: string, UTI: string): Promise<ShareOutcome> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await withLockSuspended(() => Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: file.name }));
  return 'shared';
}

export type Picked = { canceled: true } | { canceled: false; name: string; bytes: Uint8Array };

/** The picked file is larger than the caller's limit; nothing was read (review S6). */
export class FileTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`picked file has ${size} bytes`);
    this.name = 'FileTooLargeError';
  }
}

let devNext: { name: string; bytes: Uint8Array } | null = null;

/** Dev only: the next `pickFile()` returns these bytes instead of opening the system picker. */
export function setDevPick(name: string, bytes: Uint8Array): void {
  if (__DEV__) devNext = { name, bytes };
}

/**
 * The system document picker; returns the file's bytes (backups and Daylio files are read whole, D44). A file above
 * `maxBytes` is refused before it is read (FileTooLargeError), so a huge file cannot exhaust the memory first.
 */
export async function pickFile(maxBytes = Number.POSITIVE_INFINITY): Promise<Picked> {
  if (__DEV__ && devNext) {
    const next = devNext;
    devNext = null;
    return { canceled: false, ...next };
  }
  const r = await withLockSuspended(() => File.pickFileAsync());
  if (r.canceled) return { canceled: true };
  const file = r.result;
  const size = file.size ?? 0;
  if (size > maxBytes) throw new FileTooLargeError(size);
  return { canceled: false, name: file.name, bytes: await file.bytes() };
}
