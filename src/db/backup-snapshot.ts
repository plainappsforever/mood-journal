// Database ↔ backup snapshot (SPEC "Backup file": data.json = all tables). Restore REPLACES everything in one
// transaction (after the glue staged the photo files); a damaged or newer snapshot changes nothing.
// Device-only settings (backup folder, last backup status, lock) are neither exported nor overwritten (D43).
import type { Snapshot, TableDump } from '@/engine/backup-container';
import { BackupError, isPhotoName } from '@/engine/backup-container';

import { insertRows } from './bulk';
import { LATEST_VERSION } from './migrations';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

/** Parent tables first (insert order); deletes run in reverse. */
export const BACKUP_TABLES = ['moods', 'activity_groups', 'activities', 'entries', 'entry_activities', 'photos', 'goals', 'reminders', 'import_runs', 'settings'] as const;
export const DEVICE_SETTING_PREFIXES = ['backup_folder', 'backup_last', 'lock_'] as const;
const isDeviceSetting = (key: unknown) => typeof key === 'string' && DEVICE_SETTING_PREFIXES.some((p) => key.startsWith(p));

async function columnsOf(db: Db, table: string): Promise<string[]> {
  const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return info.map((c) => c.name);
}

export async function exportSnapshot(db: Db): Promise<Snapshot> {
  return withRead(db, async (r) => {
    const v = await r.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const tables: Record<string, TableDump> = {};
    for (const table of BACKUP_TABLES) {
      const columns = await columnsOf(r, table);
      const order = table === 'entry_activities' ? 'entry_id, activity_id' : table === 'settings' ? 'key' : 'id';
      const rows = await r.getAllAsync<Record<string, string | number | null>>(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${order}`);
      tables[table] = {
        columns,
        rows: rows.filter((row) => table !== 'settings' || !isDeviceSetting(row.key)).map((row) => columns.map((c) => row[c] ?? null)),
      };
    }
    return { schemaVersion: v?.user_version ?? 0, tables };
  });
}

/** Photo file names a snapshot refers to (the glue checks they were staged before restoring). */
export function snapshotPhotoFiles(snapshot: Snapshot): string[] {
  const t = snapshot.tables.photos;
  if (!t) return [];
  const i = t.columns.indexOf('file');
  return t.rows.map((r) => String(r[i]));
}

export async function restoreSnapshot(db: Db, snapshot: Snapshot): Promise<{ entries: number; photos: number }> {
  if (snapshot.schemaVersion > LATEST_VERSION) throw new BackupError('newer-version', `database ${snapshot.schemaVersion}`);
  if (snapshot.schemaVersion !== LATEST_VERSION) throw new BackupError('unsupported', `database ${snapshot.schemaVersion}`); // only v2 exists yet
  for (const name of Object.keys(snapshot.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(name)) throw new BackupError('damaged', `unknown table ${name}`);
  }
  // Restore never trusts the file (review S7): every table present, photo names safe, moods sane (checked below).
  for (const table of BACKUP_TABLES) if (!snapshot.tables[table]) throw new BackupError('damaged', `missing table ${table}`);
  const photoFile = snapshot.tables.photos.columns.indexOf('file');
  if (photoFile < 0 && snapshot.tables.photos.rows.length > 0) throw new BackupError('damaged', 'photos without file');
  for (const row of snapshot.tables.photos.rows) if (!isPhotoName(row[photoFile])) throw new BackupError('damaged', `photo name ${String(row[photoFile])}`);
  return withTransaction(db, async (tx) => {
    const keep = (await tx.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings')).filter((s) => isDeviceSetting(s.key));
    for (const table of [...BACKUP_TABLES].reverse()) await tx.runAsync(`DELETE FROM ${table}`);
    for (const table of BACKUP_TABLES) {
      const dump = snapshot.tables[table];
      const allowed = await columnsOf(tx, table);
      for (const c of dump.columns) if (!allowed.includes(c)) throw new BackupError('damaged', `unknown column ${table}.${c}`);
      const keyIndex = dump.columns.indexOf('key');
      const rows = table === 'settings' ? dump.rows.filter((row) => !isDeviceSetting(row[keyIndex])) : dump.rows;
      for (const row of rows) if (row.length !== dump.columns.length) throw new BackupError('damaged', `row length in ${table}`);
      await insertRows(tx, table, dump.columns, rows); // multi-row INSERTs (review S9), same transaction
    }
    for (const s of keep) await tx.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', s.key, s.value);
    // Inside the transaction, so a failure rolls the whole restore back: colours #RRGGBB, levels 1–5, and every level
    // keeps ≥ 1 active mood (D36 — Home shows one button per level).
    const moods = await tx.getAllAsync<{ level: unknown; color: unknown; archived: unknown }>('SELECT level, color, archived FROM moods');
    for (const m of moods) {
      if (typeof m.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(m.color)) throw new BackupError('damaged', `mood colour ${String(m.color)}`);
      if (typeof m.level !== 'number' || !Number.isInteger(m.level) || m.level < 1 || m.level > 5) throw new BackupError('damaged', `mood level ${String(m.level)}`);
    }
    for (let level = 1; level <= 5; level++) {
      if (!moods.some((m) => m.level === level && Number(m.archived) === 0)) throw new BackupError('damaged', `no active mood on level ${level}`);
    }
    const e = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM entries');
    const p = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM photos');
    return { entries: e?.n ?? 0, photos: p?.n ?? 0 };
  });
}
