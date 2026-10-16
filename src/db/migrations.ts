import { withTransaction } from './tx';
import type { Db } from './types';

// Append-only. Never edit a migration that has shipped; add a new one instead.
const MIGRATIONS: string[] = [
  `CREATE TABLE items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  // 2 — Mood schema (SPEC Data model, D14). The template's demo table `items` never shipped. Foreign keys document the
  // relations; the data functions delete child rows themselves (PRAGMA foreign_keys is off on the shared connection).
  `DROP TABLE IF EXISTS items;
   CREATE TABLE moods (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
     name TEXT NOT NULL,
     emoji TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL,
     sort INTEGER NOT NULL DEFAULT 0,
     archived INTEGER NOT NULL DEFAULT 0,
     created_ms INTEGER NOT NULL,
     import_ref TEXT
   );
   CREATE TABLE activity_groups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     sort INTEGER NOT NULL DEFAULT 0,
     archived INTEGER NOT NULL DEFAULT 0,
     created_ms INTEGER NOT NULL,
     import_ref TEXT
   );
   CREATE TABLE activities (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id INTEGER NOT NULL REFERENCES activity_groups(id),
     name TEXT NOT NULL,
     emoji TEXT NOT NULL DEFAULT '',
     sort INTEGER NOT NULL DEFAULT 0,
     archived INTEGER NOT NULL DEFAULT 0,
     created_ms INTEGER NOT NULL,
     import_ref TEXT,
     UNIQUE (group_id, name COLLATE NOCASE)
   );
   CREATE TABLE entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     mood_id INTEGER NOT NULL REFERENCES moods(id),
     local_date TEXT NOT NULL,
     local_time TEXT NOT NULL,
     utc_ms INTEGER NOT NULL,
     tz_offset_min INTEGER NOT NULL,
     note_title TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '',
     created_ms INTEGER NOT NULL,
     updated_ms INTEGER NOT NULL,
     source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'daylio_csv', 'daylio_backup', 'restore')),
     import_ref TEXT,
     UNIQUE (source, import_ref)
   );
   CREATE INDEX entries_local_date ON entries (local_date);
   CREATE INDEX entries_utc_ms ON entries (utc_ms);
   CREATE INDEX entries_mood ON entries (mood_id);
   CREATE TABLE entry_activities (
     entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
     activity_id INTEGER NOT NULL REFERENCES activities(id),
     PRIMARY KEY (entry_id, activity_id)
   ) WITHOUT ROWID;
   CREATE INDEX entry_activities_activity ON entry_activities (activity_id);
   CREATE TABLE photos (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
     file TEXT NOT NULL,
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX photos_entry ON photos (entry_id);
   CREATE TABLE goals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     activity_id INTEGER NOT NULL REFERENCES activities(id),
     period TEXT NOT NULL CHECK (period IN ('day', 'week', 'month')),
     target INTEGER NOT NULL CHECK (target >= 1),
     start_date TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     created_ms INTEGER NOT NULL
   );
   CREATE TABLE reminders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
     minute INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 59),
     weekdays INTEGER NOT NULL DEFAULT 127 CHECK (weekdays BETWEEN 0 AND 127),
     enabled INTEGER NOT NULL DEFAULT 1,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE import_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     file_name TEXT NOT NULL,
     started_ms INTEGER NOT NULL,
     entries_added INTEGER NOT NULL DEFAULT 0,
     entries_skipped INTEGER NOT NULL DEFAULT 0,
     photos_added INTEGER NOT NULL DEFAULT 0,
     warnings_json TEXT NOT NULL DEFAULT '[]'
   );`,
];

export const LATEST_VERSION = MIGRATIONS.length;
/** For migration tests only (e.g. build a version-1 database). */
export const MIGRATIONS_FOR_TEST: readonly string[] = MIGRATIONS;

export async function migrate(db: Db, migrations: string[] = MIGRATIONS): Promise<void> {
  // The version is read INSIDE each unit: another JS handle on the same connection (e.g. a background task at a cold
  // start) may have migrated meanwhile, and a migration must never run twice. One transaction per migration: a
  // failure rolls back both the schema change and user_version.
  for (;;) {
    const applied = await withTransaction(db, async (tx) => {
      const row = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      if (version >= migrations.length) return false;
      await tx.execAsync(`${migrations[version]} PRAGMA user_version = ${version + 1};`);
      return true;
    });
    if (!applied) return;
  }
}
