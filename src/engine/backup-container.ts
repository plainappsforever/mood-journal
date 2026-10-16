// Mood backup file `mood-YYYY-MM-DD.moodbackup` (SPEC "Import, export, backup", D18). PURE: crypto is injected
// (Node in Jest, expo-crypto + PBKDF2 in the app), bytes in, bytes out.
//
// Plain file = ZIP (fflate): manifest.json (format, app version, counts, sha256 + size per member), data.json (all
// tables, src/db/backup-snapshot.ts), photos/<file>.
// Encrypted file = the same ZIP sealed in the Warranty Wallet D21 container, renamed:
//   "MOODBK1" | u32 header length | header JSON (NOT secret: format, KDF, iterations, salt, createdAt, appVersion)
//   then entries: u32 length | sealed (nonce 12 ‖ ciphertext ‖ tag 16, AES-256-GCM)
//   entry plaintext = u32 index | u8 flags (1 = last) | payload; entry 0 = meta JSON {zipSize}, then the ZIP in
//   chunks of ≤ 1 MiB. Index and "last" sit inside the authenticated plaintext: dropped/reordered/cut entries = damage.
// Memory: the ZIP is built and read in memory (fine for journals with a few hundred photos; P8 measures, D44).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const BACKUP_FORMAT = 1;
export const MAGIC = 'MOODBK1';
export const KDF_NAME = 'pbkdf2-sha256';
export const BACKUP_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const CHUNK_SIZE = 1024 * 1024;
export const MIN_ITERATIONS = 1000;
export const MAX_ITERATIONS = 10_000_000;
const MAX_HEADER_BYTES = 4096;
const OVERHEAD = 12 + 16;

export type BackupErrorCode =
  | 'not-a-backup'
  | 'newer-version' // written by a newer app
  | 'password-needed' // encrypted, no password given
  | 'wrong-password' // wrong password or damaged header entry (AES-GCM cannot tell them apart)
  | 'damaged'
  | 'unsupported'; // a database version this app cannot restore

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BackupError';
  }
}

export type TableDump = { columns: string[]; rows: (string | number | null)[][] };
export type Snapshot = { schemaVersion: number; tables: Record<string, TableDump> };
export type BackupManifest = {
  format: number;
  app: 'mood';
  appVersion: string;
  createdAt: string;
  schemaVersion: number;
  counts: { entries: number; photos: number; moods: number; activities: number };
  members: Record<string, { size: number; sha256: string }>;
};
export type BackupPhoto = { name: string; bytes: Uint8Array };

const hash = (b: Uint8Array) => bytesToHex(sha256(b));
const PHOTO_NAME = /^[A-Za-z0-9._-]{1,128}$/;
/** A safe photo file name: one path segment, no leading dot (so never `..` or a hidden file). Review S7. */
export const isPhotoName = (name: unknown): name is string => typeof name === 'string' && PHOTO_NAME.test(name) && !name.startsWith('.');

export function buildBackupZip(input: { snapshot: Snapshot; photos: readonly BackupPhoto[]; appVersion: string; createdAt: string }): Uint8Array {
  const data = strToU8(JSON.stringify(input.snapshot));
  const files: Record<string, Uint8Array> = { 'data.json': data };
  for (const p of input.photos) {
    if (!isPhotoName(p.name)) throw new Error(`bad photo name ${p.name}`);
    files[`photos/${p.name}`] = p.bytes;
  }
  const rows = (t: string) => input.snapshot.tables[t]?.rows.length ?? 0;
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    app: 'mood',
    appVersion: input.appVersion,
    createdAt: input.createdAt,
    schemaVersion: input.snapshot.schemaVersion,
    counts: { entries: rows('entries'), photos: input.photos.length, moods: rows('moods'), activities: rows('activities') },
    members: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { size: bytes.length, sha256: hash(bytes) }])),
  };
  // Photos are already JPEG: store them; compress the JSON.
  const entries = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { level: name.startsWith('photos/') ? 0 : 6 }] as [Uint8Array, { level: 0 | 6 }]]));
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...entries });
}

function assertSnapshot(s: unknown): asserts s is Snapshot {
  const bad = (what: string) => new BackupError('damaged', `data ${what}`);
  if (!s || typeof s !== 'object') throw bad('type');
  const snap = s as Snapshot;
  if (!Number.isInteger(snap.schemaVersion) || snap.schemaVersion < 1) throw bad('schemaVersion');
  if (!snap.tables || typeof snap.tables !== 'object' || Array.isArray(snap.tables)) throw bad('tables');
  for (const dump of Object.values(snap.tables)) {
    if (!Array.isArray(dump?.columns) || !dump.columns.every((c) => typeof c === 'string')) throw bad('columns');
    if (!Array.isArray(dump.rows)) throw bad('rows');
    for (const row of dump.rows) {
      if (!Array.isArray(row) || row.length !== dump.columns.length) throw bad('row length');
      for (const v of row) if (v !== null && typeof v !== 'string' && typeof v !== 'number') throw bad('value');
    }
  }
}

/** Opens a plain backup ZIP and verifies every member against the manifest. */
export function readBackupZip(bytes: Uint8Array): { manifest: BackupManifest; snapshot: Snapshot; photos: Map<string, Uint8Array> } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new BackupError('not-a-backup', 'not a ZIP');
  }
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new BackupError('not-a-backup', 'no manifest');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest;
  } catch {
    throw new BackupError('damaged', 'manifest JSON');
  }
  if (manifest?.app !== 'mood') throw new BackupError('not-a-backup', 'other app');
  if (!Number.isInteger(manifest.format) || manifest.format > BACKUP_FORMAT) throw new BackupError('newer-version', `format ${String(manifest.format)}`);
  if (!manifest.members || typeof manifest.members !== 'object') throw new BackupError('damaged', 'members');
  for (const [name, meta] of Object.entries(manifest.members)) {
    const member = files[name];
    if (!member) throw new BackupError('damaged', `missing ${name}`);
    if (member.length !== meta.size || hash(member) !== meta.sha256) throw new BackupError('damaged', `checksum ${name}`);
  }
  for (const name of Object.keys(files)) {
    if (name !== 'manifest.json' && !(name in manifest.members)) throw new BackupError('damaged', `unexpected ${name}`);
  }
  if (!('data.json' in manifest.members)) throw new BackupError('damaged', 'no data');
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(strFromU8(files['data.json']));
  } catch {
    throw new BackupError('damaged', 'data JSON');
  }
  assertSnapshot(snapshot);
  if (snapshot.schemaVersion !== manifest.schemaVersion) throw new BackupError('damaged', 'schema version mismatch');
  const photos = new Map<string, Uint8Array>();
  for (const [name, b] of Object.entries(files)) {
    if (!name.startsWith('photos/')) continue;
    const file = name.slice('photos/'.length);
    // A crafted but checksum-valid file must not smuggle "../" into the photo folder (review S7).
    if (!isPhotoName(file)) throw new BackupError('damaged', `photo name ${name}`);
    photos.set(file, b);
  }
  return { manifest, snapshot, photos };
}

// ------------------------------------------------------------------------------------------------ encryption

/** Opaque key handle: Node KeyObject/Buffer in tests, an expo-crypto key in the app. */
export type KeyHandle = unknown;
export interface BackupCrypto {
  randomBytes(count: number): Uint8Array;
  deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<KeyHandle>;
  /** nonce ‖ ciphertext ‖ tag, fresh random nonce per call. */
  seal(key: KeyHandle, plaintext: Uint8Array): Promise<Uint8Array>;
  /** Throws when the tag does not verify. */
  open(key: KeyHandle, sealed: Uint8Array): Promise<Uint8Array>;
}

type SealedHeader = { format: number; kdf: string; iterations: number; salt: string; createdAt: string; appVersion: string };

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/** Same password bytes on every phone: Unicode NFKC (the KDF glue encodes UTF-8). */
export function normalisePassword(password: string): string {
  try {
    return password.normalize('NFKC');
  } catch {
    return password;
  }
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}
const readU32 = (b: Uint8Array, at = 0) => new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, false);
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/.test(hex)) throw new BackupError('damaged', 'salt');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export type BackupKind = 'zip' | 'sealed' | 'newer-sealed' | 'unknown';

export function detectBackup(bytes: Uint8Array): BackupKind {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return 'zip';
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, MAGIC.length));
  if (head === MAGIC) return 'sealed';
  if (/^MOODBK\d$/.test(head)) return 'newer-sealed';
  return 'unknown';
}

export async function sealBackup(
  zip: Uint8Array,
  opts: { crypto: BackupCrypto; password: string; iterations?: number; createdAt: string; appVersion: string }
): Promise<Uint8Array> {
  const iterations = opts.iterations ?? BACKUP_ITERATIONS;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('iterations out of range');
  if (!opts.password) throw new Error('empty password');
  const salt = opts.crypto.randomBytes(SALT_BYTES);
  const key = await opts.crypto.deriveKey(normalisePassword(opts.password), salt, iterations);
  const header: SealedHeader = { format: BACKUP_FORMAT, kdf: KDF_NAME, iterations, salt: bytesToHex(salt), createdAt: opts.createdAt, appVersion: opts.appVersion };
  const headerBytes = enc.encode(JSON.stringify(header));
  const parts: Uint8Array[] = [enc.encode(MAGIC), u32(headerBytes.length), headerBytes];
  const chunks = Math.max(1, Math.ceil(zip.length / CHUNK_SIZE));
  const total = 1 + chunks;
  const put = async (index: number, payload: Uint8Array) => {
    const sealed = await opts.crypto.seal(key, concat(u32(index), new Uint8Array([index === total - 1 ? 1 : 0]), payload));
    parts.push(u32(sealed.length), sealed);
  };
  await put(0, enc.encode(JSON.stringify({ zipSize: zip.length })));
  for (let i = 0; i < chunks; i++) await put(1 + i, zip.subarray(i * CHUNK_SIZE, Math.min(zip.length, (i + 1) * CHUNK_SIZE)));
  return concat(...parts);
}

/** Returns the ZIP inside an encrypted backup. Wrong password → 'wrong-password'; any later problem → 'damaged'. */
export async function openSealedBackup(bytes: Uint8Array, crypto: BackupCrypto, password: string): Promise<Uint8Array> {
  const kind = detectBackup(bytes);
  if (kind === 'newer-sealed') throw new BackupError('newer-version');
  if (kind !== 'sealed') throw new BackupError('not-a-backup');
  let at = MAGIC.length;
  const need = (n: number) => {
    if (at + n > bytes.length) throw new BackupError('damaged', 'file ends early');
  };
  need(4);
  const headerLength = readU32(bytes, at);
  at += 4;
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) throw new BackupError('damaged', 'header length');
  need(headerLength);
  let header: SealedHeader;
  try {
    header = JSON.parse(dec.decode(bytes.subarray(at, at + headerLength))) as SealedHeader;
  } catch {
    throw new BackupError('damaged', 'header JSON');
  }
  at += headerLength;
  if (header.format !== BACKUP_FORMAT || header.kdf !== KDF_NAME) throw new BackupError('newer-version', `format ${String(header.format)} ${String(header.kdf)}`);
  if (!Number.isInteger(header.iterations) || header.iterations < MIN_ITERATIONS || header.iterations > MAX_ITERATIONS) throw new BackupError('damaged', 'iterations');
  const salt = fromHex(String(header.salt));
  if (salt.length !== SALT_BYTES) throw new BackupError('damaged', 'salt');
  const key = await crypto.deriveKey(normalisePassword(password), salt, header.iterations);

  const next = async (index: number, firstWrongPassword: boolean) => {
    need(4);
    const length = readU32(bytes, at);
    at += 4;
    if (length < OVERHEAD + 5) throw new BackupError('damaged', 'entry length');
    need(length);
    let plain: Uint8Array;
    try {
      plain = await crypto.open(key, bytes.subarray(at, at + length));
    } catch {
      throw new BackupError(firstWrongPassword ? 'wrong-password' : 'damaged', `entry ${index}`);
    }
    at += length;
    if (plain.length < 5 || readU32(plain) !== index) throw new BackupError(firstWrongPassword ? 'wrong-password' : 'damaged', 'entry order');
    return { last: plain[4] === 1, payload: plain.subarray(5) };
  };
  const first = await next(0, true);
  let zipSize: number;
  try {
    zipSize = Number(JSON.parse(dec.decode(first.payload)).zipSize);
  } catch {
    throw new BackupError('damaged', 'meta');
  }
  if (!Number.isInteger(zipSize) || zipSize < 0) throw new BackupError('damaged', 'zip size');
  const chunks = Math.max(1, Math.ceil(zipSize / CHUNK_SIZE));
  if (first.last) throw new BackupError('damaged', 'last entry flag');
  const out = new Uint8Array(zipSize);
  let offset = 0;
  for (let i = 0; i < chunks; i++) {
    const { last, payload } = await next(1 + i, false);
    if (last !== (i === chunks - 1)) throw new BackupError('damaged', 'last entry flag');
    if (offset + payload.length > zipSize) throw new BackupError('damaged', 'size');
    out.set(payload, offset);
    offset += payload.length;
  }
  if (offset !== zipSize) throw new BackupError('damaged', 'size');
  if (at !== bytes.length) throw new BackupError('damaged', 'data after the last entry');
  return out;
}

/** Any backup file → manifest, snapshot and photos (password only needed for encrypted files). */
export async function readBackupFile(bytes: Uint8Array, opts: { crypto: BackupCrypto; password?: string }) {
  const kind = detectBackup(bytes);
  if (kind === 'unknown') throw new BackupError('not-a-backup');
  if (kind === 'newer-sealed') throw new BackupError('newer-version');
  if (kind === 'sealed') {
    if (!opts.password) throw new BackupError('password-needed');
    return { encrypted: true, ...readBackupZip(await openSealedBackup(bytes, opts.crypto, opts.password)) };
  }
  return { encrypted: false, ...readBackupZip(bytes) };
}

export function backupFileName(date: string, auto: boolean): string {
  return `${auto ? 'mood-auto' : 'mood'}-${date}.moodbackup`;
}
