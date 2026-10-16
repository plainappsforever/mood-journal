/**
 * @jest-environment node
 */
// Backup round trip (A6, unit part): journal → snapshot → ZIP (→ sealed) → restore into another journal.
import { createHash } from 'node:crypto';

import { strToU8, unzipSync, zipSync } from 'fflate';

import { createTestDb } from '../../test/node-sqlite-db';
import { nodeBackupCrypto } from '../../test/node-backup-crypto';

import {
  BackupError,
  backupFileName,
  buildBackupZip,
  detectBackup,
  openSealedBackup,
  readBackupFile,
  readBackupZip,
  sealBackup,
} from '@/engine/backup-container';

import { addActivity, listActivities, listGroups } from './activities';
import { exportSnapshot, restoreSnapshot, snapshotPhotoFiles } from './backup-snapshot';
import { addEntry, addPhoto } from './entries';
import { addGoal } from './goals';
import { migrate } from './migrations';
import { listMoods } from './moods';
import { addReminder } from './reminders';
import { seedDefaults } from './seed';
import { setSetting } from './settings';
import type { Db } from './types';

const ITER = 1000; // tests only; the app uses 600,000
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof BackupError ? e.code : String(e)));

async function journal(lang: 'en' | 'de' = 'en'): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  await seedDefaults(db, lang, 1);
  return db;
}

async function filled(): Promise<Db> {
  const db = await journal();
  const moods = await listMoods(db);
  const group = (await listGroups(db))[0].id;
  const pets = await addActivity(db, { groupId: group, name: 'pets 🐶', emoji: '🐶' }, 2);
  const acts = (await listActivities(db)).slice(0, 3).map((a) => a.id);
  for (let i = 0; i < 40; i++) {
    const id = await addEntry(
      db,
      { moodId: moods[i % 5].id, localDate: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, localTime: '20:00', utcMs: 1_788_000_000_000 + i, tzOffsetMin: 120, noteTitle: i ? '' : 'Title "quoted"', note: `note ${i}\nzweite Zeile äöü`, activityIds: i % 2 ? [acts[i % 3], pets] : [] },
      { now: 100 + i, today: '2026-10-16' }
    );
    if (i < 2) await addPhoto(db, id, { file: `p${i}.jpg`, width: 1600, height: 1200, bytes: 3, sha256: 'h' });
  }
  await addGoal(db, { activityId: pets, period: 'week', target: 3, startDate: '2026-09-01' }, 5);
  await addReminder(db, { hour: 20, minute: 0, weekdays: 127, enabled: true });
  await setSetting(db, 'week_start', '7');
  await setSetting(db, 'backup_folder_uri', 'content://device-A');
  await setSetting(db, 'lock_enabled', '1');
  return db;
}

const photos = [
  { name: 'p0.jpg', bytes: new Uint8Array([1, 2, 3]) },
  { name: 'p1.jpg', bytes: new Uint8Array([4, 5, 6]) },
];

async function dump(db: Db) {
  const s = await exportSnapshot(db);
  return JSON.stringify(s.tables);
}

describe('backup round trip (A6, unit)', () => {
  it('plain: every row and photo byte comes back identical; device settings stay on their device', async () => {
    const a = await filled();
    const snapshot = await exportSnapshot(a);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.tables.settings.rows.map((r) => r[0])).not.toContain('backup_folder_uri');
    expect(snapshot.tables.settings.rows.map((r) => r[0])).not.toContain('lock_enabled');
    expect(snapshotPhotoFiles(snapshot)).toEqual(['p0.jpg', 'p1.jpg']);
    const zip = buildBackupZip({ snapshot, photos, appVersion: '1.0.0', createdAt: '2026-10-16T10:00:00Z' });
    expect(detectBackup(zip)).toBe('zip');

    const b = await journal('de'); // a different phone with German defaults and its own folder setting
    await setSetting(b, 'backup_folder_uri', 'bookmark://device-B');
    const opened = await readBackupFile(zip, { crypto: nodeBackupCrypto });
    expect(opened.encrypted).toBe(false);
    expect(opened.manifest.counts).toEqual({ entries: 40, photos: 2, moods: 5, activities: 28 });
    expect(opened.photos.get('p1.jpg')).toEqual(photos[1].bytes);
    expect(await restoreSnapshot(b, opened.snapshot)).toEqual({ entries: 40, photos: 2 });
    const restored = JSON.parse(await dump(b));
    const original = JSON.parse(await dump(a));
    expect(restored).toEqual(original);
    expect(await b.getFirstAsync("SELECT value FROM settings WHERE key = 'backup_folder_uri'")).toEqual({ value: 'bookmark://device-B' });
  });

  it('encrypted: same result with the password; wrong password and missing password are told apart', async () => {
    const a = await filled();
    const zip = buildBackupZip({ snapshot: await exportSnapshot(a), photos, appVersion: '1.0.0', createdAt: 'x' });
    const sealed = await sealBackup(zip, { crypto: nodeBackupCrypto, password: 'correct horse ﬁ', iterations: ITER, createdAt: 'x', appVersion: '1.0.0' });
    expect(detectBackup(sealed)).toBe('sealed');
    expect(new TextDecoder().decode(sealed)).not.toContain('note 1'); // no plaintext journal text in the file
    // NFKC: the ligature "ﬁ" and "fi" are the same password on every phone
    expect(Buffer.from(await openSealedBackup(sealed, nodeBackupCrypto, 'correct horse fi')).equals(Buffer.from(zip))).toBe(true);
    expect(await code(openSealedBackup(sealed, nodeBackupCrypto, 'wrong'))).toBe('wrong-password');
    expect(await code(readBackupFile(sealed, { crypto: nodeBackupCrypto }))).toBe('password-needed');
    const b = await journal();
    const opened = await readBackupFile(sealed, { crypto: nodeBackupCrypto, password: 'correct horse fi' });
    await restoreSnapshot(b, opened.snapshot);
    expect(await dump(b)).toBe(await dump(a));
  });

  it('a 3 MB backup spans several encrypted chunks; tampering anywhere is detected', async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 7);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
    const a = await filled();
    const zip = buildBackupZip({ snapshot: await exportSnapshot(a), photos: [{ name: 'big.jpg', bytes: big }], appVersion: '1', createdAt: 'x' });
    const sealed = await sealBackup(zip, { crypto: nodeBackupCrypto, password: 'pw', iterations: ITER, createdAt: 'x', appVersion: '1' });
    const back = (await readBackupFile(sealed, { crypto: nodeBackupCrypto, password: 'pw' })).photos.get('big.jpg')!;
    expect(Buffer.from(back).equals(Buffer.from(big))).toBe(true); // toEqual on megabytes is very slow in Jest
    const flipped = sealed.slice();
    flipped[flipped.length - 100] ^= 1;
    expect(await code(openSealedBackup(flipped, nodeBackupCrypto, 'pw'))).toBe('damaged');
    expect(await code(openSealedBackup(sealed.subarray(0, sealed.length - 20), nodeBackupCrypto, 'pw'))).toBe('damaged');
    const longer = new Uint8Array(sealed.length + 1);
    longer.set(sealed);
    expect(await code(openSealedBackup(longer, nodeBackupCrypto, 'pw'))).toBe('damaged');
  });

  it('refuses foreign, newer, damaged and tampered plain backups without touching the journal', async () => {
    const a = await filled();
    const snapshot = await exportSnapshot(a);
    const zip = buildBackupZip({ snapshot, photos, appVersion: '1', createdAt: 'x' });
    expect(await code(readBackupFile(new TextEncoder().encode('hello'), { crypto: nodeBackupCrypto }))).toBe('not-a-backup');
    expect(await code(readBackupFile(new TextEncoder().encode('MOODBK2...'), { crypto: nodeBackupCrypto }))).toBe('newer-version');
    const files = unzipSync(zip);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    const rezip = (over: Record<string, Uint8Array>) => zipSync({ ...files, ...over });
    expect(() => readBackupZip(rezip({ 'manifest.json': strToU8(JSON.stringify({ ...manifest, format: 2 })) }))).toThrow(/newer-version/);
    expect(() => readBackupZip(rezip({ 'manifest.json': strToU8(JSON.stringify({ ...manifest, app: 'ww' })) }))).toThrow(/not-a-backup/);
    expect(() => readBackupZip(rezip({ 'photos/p0.jpg': new Uint8Array([9, 9, 9]) }))).toThrow(/damaged: checksum photos\/p0.jpg/);
    expect(() => readBackupZip(rezip({ 'photos/extra.jpg': new Uint8Array([1]) }))).toThrow(/damaged: unexpected/);
    const b = await filled();
    const before = await dump(b);
    expect(await code(restoreSnapshot(b, { ...snapshot, schemaVersion: 3 }))).toBe('newer-version');
    const evil = structuredClone(snapshot);
    evil.tables.entries.columns[1] = 'mood_id) VALUES (1); DROP TABLE moods; --';
    expect(await code(restoreSnapshot(b, evil))).toBe('damaged');
    const broken = structuredClone(snapshot);
    broken.tables.entries.rows[39][1] = null; // NOT NULL mood_id on the last row: the whole restore rolls back
    await expect(restoreSnapshot(b, broken)).rejects.toThrow();
    expect(await dump(b)).toBe(before);
  });

  it('file names', () => {
    expect(backupFileName('2026-10-16', false)).toBe('mood-2026-10-16.moodbackup');
    expect(backupFileName('2026-10-16', true)).toBe('mood-auto-2026-10-16.moodbackup');
    expect(() => buildBackupZip({ snapshot: { schemaVersion: 2, tables: {} }, photos: [{ name: '../x.jpg', bytes: new Uint8Array() }], appVersion: '1', createdAt: 'x' })).toThrow(/bad photo name/);
  });
});

describe('restore never trusts the file (review S7)', () => {
  it('refuses a checksum-valid backup whose photo member escapes the photo folder', async () => {
    const a = await filled();
    const zip = buildBackupZip({ snapshot: await exportSnapshot(a), photos, appVersion: '1', createdAt: 'x' });
    const files = unzipSync(zip);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    const evil = new Uint8Array([7, 7]);
    for (const name of ['photos/../../evil.jpg', 'photos/.hidden', 'photos/sub/x.jpg']) {
      const members = { ...manifest.members, [name]: { size: evil.length, sha256: createHash('sha256').update(evil).digest('hex') } };
      const crafted = zipSync({ ...files, [name]: evil, 'manifest.json': strToU8(JSON.stringify({ ...manifest, members })) });
      expect(() => readBackupZip(crafted)).toThrow(/damaged: photo name/);
    }
  });

  it('refuses snapshots with a missing table, unsafe photo file, bad colour/level or an empty level — journal unchanged', async () => {
    const a = await filled();
    const snapshot = await exportSnapshot(a);
    const b = await filled();
    const before = await dump(b);
    const noMoods = structuredClone(snapshot);
    delete (noMoods.tables as Record<string, unknown>).moods;
    expect(await code(restoreSnapshot(b, noMoods))).toBe('damaged');
    const badFile = structuredClone(snapshot);
    badFile.tables.photos.rows[0][badFile.tables.photos.columns.indexOf('file')] = '../../SQLite/app.db';
    expect(await code(restoreSnapshot(b, badFile))).toBe('damaged');
    const colour = structuredClone(snapshot);
    colour.tables.moods.rows[0][colour.tables.moods.columns.indexOf('color')] = '#000"><script>x()</script>';
    expect(await code(restoreSnapshot(b, colour))).toBe('damaged');
    const level = structuredClone(snapshot);
    level.tables.moods.rows[0][level.tables.moods.columns.indexOf('level')] = 9;
    await expect(restoreSnapshot(b, level)).rejects.toThrow(); // the schema's CHECK already refuses it; checked again after insert
    const archivedLevel = structuredClone(snapshot);
    const li = archivedLevel.tables.moods.columns.indexOf('level');
    const ai = archivedLevel.tables.moods.columns.indexOf('archived');
    for (const row of archivedLevel.tables.moods.rows) if (row[li] === 3) row[ai] = 1;
    expect(await code(restoreSnapshot(b, archivedLevel))).toBe('damaged');
    expect(await dump(b)).toBe(before);
    expect(await restoreSnapshot(b, snapshot)).toEqual({ entries: 40, photos: 2 }); // the honest file still restores
  });
});
