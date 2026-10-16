// Entries (SPEC Data model). An entry stores its journal day as text (`local_date`, `local_time`) plus the real moment
// (`utc_ms`, `tz_offset_min`); the screens build these with src/engine/dates.ts (journalDayOf / utcForJournalTime).
// Its level is always its mood's CURRENT level (changing a mood's level re-levels its entries).
import { checkEntryDate, isValidTime, type DateStr } from '@/engine/dates';

import { DataRuleError } from './errors';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export const NOTE_MAX = 100_000;
export const TITLE_MAX = 200;

export type EntrySource = 'app' | 'daylio_csv' | 'daylio_backup' | 'restore';

export type EntryInput = {
  moodId: number;
  localDate: DateStr;
  localTime: string;
  utcMs: number;
  tzOffsetMin: number;
  noteTitle: string;
  note: string;
  activityIds: number[];
};

export type Photo = { id: number; entryId: number; file: string; width: number; height: number; bytes: number; sha256: string; sort: number };

export type Entry = EntryInput & {
  id: number;
  level: number;
  createdMs: number;
  updatedMs: number;
  source: EntrySource;
  importRef: string | null;
  photos: Photo[];
};

/** The plain shape every statistics engine takes (src/engine/stats). */
export type StatEntry = { id: number; moodId: number; level: number; date: DateStr; time: string; utcMs: number; activityIds: number[] };

type EntryRow = {
  id: number;
  mood_id: number;
  level: number;
  local_date: string;
  local_time: string;
  utc_ms: number;
  tz_offset_min: number;
  note_title: string;
  note: string;
  created_ms: number;
  updated_ms: number;
  source: EntrySource;
  import_ref: string | null;
  acts: string | null;
};

type PhotoRow = { id: number; entry_id: number; file: string; width: number; height: number; bytes: number; sha256: string; sort: number };

const toPhoto = (r: PhotoRow): Photo => ({ id: r.id, entryId: r.entry_id, file: r.file, width: r.width, height: r.height, bytes: r.bytes, sha256: r.sha256, sort: r.sort });

function ids(list: string | null): number[] {
  return list ? list.split(',').map(Number).sort((a, b) => a - b) : [];
}

function validate(input: EntryInput, today: DateStr): EntryInput {
  const date = checkEntryDate(input.localDate, today);
  if (date === 'future') throw new DataRuleError('future-date', input.localDate);
  if (date === 'too-early') throw new DataRuleError('too-early', input.localDate);
  if (date === 'invalid') throw new DataRuleError('invalid', `date ${input.localDate}`);
  if (!isValidTime(input.localTime)) throw new DataRuleError('invalid', `time ${input.localTime}`);
  if (!Number.isFinite(input.utcMs) || !Number.isInteger(input.tzOffsetMin)) throw new DataRuleError('invalid', 'moment');
  const noteTitle = input.noteTitle.trim();
  if (noteTitle.length > TITLE_MAX) throw new DataRuleError('invalid', 'title too long');
  if (input.note.length > NOTE_MAX) throw new DataRuleError('invalid', 'note too long');
  return { ...input, noteTitle, note: input.note.replace(/\s+$/, ''), activityIds: [...new Set(input.activityIds)] };
}

async function writeActivities(tx: Db, entryId: number, activityIds: number[]) {
  await tx.runAsync('DELETE FROM entry_activities WHERE entry_id = ?', entryId);
  for (const a of activityIds) {
    const found = await tx.getFirstAsync<{ id: number }>('SELECT id FROM activities WHERE id = ?', a);
    if (!found) throw new DataRuleError('not-found', `activity ${a}`);
    await tx.runAsync('INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)', entryId, a);
  }
}

async function requireMood(tx: Db, moodId: number) {
  const mood = await tx.getFirstAsync<{ id: number }>('SELECT id FROM moods WHERE id = ?', moodId);
  if (!mood) throw new DataRuleError('not-found', `mood ${moodId}`);
}

/** Inserts an entry with its activities. `today` = device local date (limit today + 1). */
export async function addEntry(
  db: Db,
  raw: EntryInput,
  opts: { now: number; today: DateStr; source?: EntrySource; importRef?: string | null }
): Promise<number> {
  const input = validate(raw, opts.today);
  return withTransaction(db, async (tx) => {
    await requireMood(tx, input.moodId);
    const { lastInsertRowId } = await tx.runAsync(
      `INSERT INTO entries (mood_id, local_date, local_time, utc_ms, tz_offset_min, note_title, note, created_ms, updated_ms, source, import_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.moodId,
      input.localDate,
      input.localTime,
      input.utcMs,
      input.tzOffsetMin,
      input.noteTitle,
      input.note,
      opts.now,
      opts.now,
      opts.source ?? 'app',
      opts.importRef ?? null
    );
    await writeActivities(tx, lastInsertRowId, input.activityIds);
    return lastInsertRowId;
  });
}

export async function updateEntry(db: Db, id: number, raw: EntryInput, opts: { now: number; today: DateStr }): Promise<void> {
  const input = validate(raw, opts.today);
  return withTransaction(db, async (tx) => {
    await requireMood(tx, input.moodId);
    const r = await tx.runAsync(
      `UPDATE entries SET mood_id = ?, local_date = ?, local_time = ?, utc_ms = ?, tz_offset_min = ?, note_title = ?, note = ?, updated_ms = ?
        WHERE id = ?`,
      input.moodId,
      input.localDate,
      input.localTime,
      input.utcMs,
      input.tzOffsetMin,
      input.noteTitle,
      input.note,
      opts.now,
      id
    );
    if (r.changes === 0) throw new DataRuleError('not-found', `entry ${id}`);
    await writeActivities(tx, id, input.activityIds);
  });
}

/** Deletes the entry, its activity links and photo rows. Returns the photo file names for the glue to remove. */
export async function deleteEntry(db: Db, id: number): Promise<string[]> {
  return withTransaction(db, async (tx) => {
    const photos = await tx.getAllAsync<{ file: string }>('SELECT file FROM photos WHERE entry_id = ? ORDER BY sort, id', id);
    await tx.runAsync('DELETE FROM entry_activities WHERE entry_id = ?', id);
    await tx.runAsync('DELETE FROM photos WHERE entry_id = ?', id);
    const r = await tx.runAsync('DELETE FROM entries WHERE id = ?', id);
    if (r.changes === 0) throw new DataRuleError('not-found', `entry ${id}`);
    return photos.map((p) => p.file);
  });
}

const SELECT_ENTRY = `SELECT e.id, e.mood_id, m.level, e.local_date, e.local_time, e.utc_ms, e.tz_offset_min, e.note_title, e.note,
         e.created_ms, e.updated_ms, e.source, e.import_ref,
         (SELECT group_concat(activity_id) FROM entry_activities ea WHERE ea.entry_id = e.id) AS acts
    FROM entries e JOIN moods m ON m.id = e.mood_id`;

function toEntry(r: EntryRow, photos: Photo[]): Entry {
  return {
    id: r.id,
    moodId: r.mood_id,
    level: r.level,
    localDate: r.local_date,
    localTime: r.local_time,
    utcMs: r.utc_ms,
    tzOffsetMin: r.tz_offset_min,
    noteTitle: r.note_title,
    note: r.note,
    activityIds: ids(r.acts),
    createdMs: r.created_ms,
    updatedMs: r.updated_ms,
    source: r.source,
    importRef: r.import_ref,
    photos,
  };
}

export async function getEntry(db: Db, id: number): Promise<Entry | null> {
  return withRead(db, async (r) => {
    const row = await r.getFirstAsync<EntryRow>(`${SELECT_ENTRY} WHERE e.id = ?`, id);
    if (!row) return null;
    const photos = await r.getAllAsync<PhotoRow>('SELECT * FROM photos WHERE entry_id = ? ORDER BY sort, id', id);
    return toEntry(row, photos.map(toPhoto));
  });
}

/**
 * Timeline: newest journal day first; inside a day by real moment (`utc_ms`), newest first. Optional date range
 * (inclusive) and paging.
 */
export async function listEntries(db: Db, opts: { from?: DateStr; to?: DateStr; limit?: number; offset?: number } = {}): Promise<Entry[]> {
  return withRead(db, async (r) => {
    const rows = await r.getAllAsync<EntryRow>(
      `${SELECT_ENTRY} WHERE e.local_date >= ? AND e.local_date <= ? ORDER BY e.local_date DESC, e.utc_ms DESC, e.id DESC LIMIT ? OFFSET ?`,
      opts.from ?? '0000-00-00',
      opts.to ?? '9999-99-99',
      opts.limit ?? -1,
      opts.offset ?? 0
    );
    if (rows.length === 0) return [];
    const photos = await r.getAllAsync<PhotoRow>(
      `SELECT * FROM photos WHERE entry_id IN (${rows.map(() => '?').join(',')}) ORDER BY sort, id`,
      ...rows.map((row) => row.id)
    );
    const byEntry = new Map<number, Photo[]>();
    for (const p of photos) byEntry.set(p.entry_id, [...(byEntry.get(p.entry_id) ?? []), toPhoto(p)]);
    return rows.map((row) => toEntry(row, byEntry.get(row.id) ?? []));
  });
}

/** All entries as plain engine input (one query; 20k entries in one read). */
export async function listStatEntries(db: Db): Promise<StatEntry[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<{ id: number; mood_id: number; level: number; local_date: string; local_time: string; utc_ms: number; acts: string | null }>(
      `SELECT e.id, e.mood_id, m.level, e.local_date, e.local_time, e.utc_ms, group_concat(ea.activity_id) AS acts
         FROM entries e JOIN moods m ON m.id = e.mood_id LEFT JOIN entry_activities ea ON ea.entry_id = e.id
        GROUP BY e.id`
    )
  );
  return rows.map((r) => ({ id: r.id, moodId: r.mood_id, level: r.level, date: r.local_date, time: r.local_time, utcMs: r.utc_ms, activityIds: ids(r.acts) }));
}

/** Distinct logged journal days (streaks, pixels, goal glue). */
export async function loggedDates(db: Db): Promise<DateStr[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ d: string }>('SELECT DISTINCT local_date AS d FROM entries ORDER BY d'));
  return rows.map((r) => r.d);
}

/** When the entries of one journal day were MADE (reminder planner "skip if logged", D35). */
export async function entryCreationTimes(db: Db, localDate: DateStr): Promise<number[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ c: number }>('SELECT created_ms AS c FROM entries WHERE local_date = ? ORDER BY c', localDate));
  return rows.map((r) => r.c);
}

export const MAX_PHOTOS_PER_ENTRY = 3;

export type PhotoInput = { file: string; width: number; height: number; bytes: number; sha256: string };

/** Adds a photo row (the glue stored the file under Paths.document/photos/ first). ≤ 3 per entry (D30). */
export async function addPhoto(db: Db, entryId: number, photo: PhotoInput): Promise<number> {
  return withTransaction(db, async (tx) => {
    const entry = await tx.getFirstAsync<{ id: number }>('SELECT id FROM entries WHERE id = ?', entryId);
    if (!entry) throw new DataRuleError('not-found', `entry ${entryId}`);
    const n = await tx.getFirstAsync<{ n: number; s: number | null }>('SELECT COUNT(*) AS n, MAX(sort) AS s FROM photos WHERE entry_id = ?', entryId);
    if ((n?.n ?? 0) >= MAX_PHOTOS_PER_ENTRY) throw new DataRuleError('too-many-photos');
    const r = await tx.runAsync(
      'INSERT INTO photos (entry_id, file, width, height, bytes, sha256, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
      entryId,
      photo.file,
      photo.width,
      photo.height,
      photo.bytes,
      photo.sha256,
      (n?.s ?? -1) + 1
    );
    return r.lastInsertRowId;
  });
}

/** Removes a photo row; returns its file name for the glue to delete (null if it did not exist). */
export async function removePhoto(db: Db, photoId: number): Promise<string | null> {
  return withTransaction(db, async (tx) => {
    const row = await tx.getFirstAsync<{ file: string }>('SELECT file FROM photos WHERE id = ?', photoId);
    if (!row) return null;
    await tx.runAsync('DELETE FROM photos WHERE id = ?', photoId);
    return row.file;
  });
}

/** Full entries for the given ids, in the order given (search results). */
export async function getEntries(db: Db, idList: readonly number[]): Promise<Entry[]> {
  if (idList.length === 0) return [];
  return withRead(db, async (r) => {
    const marks = idList.map(() => '?').join(',');
    const rows = await r.getAllAsync<EntryRow>(`${SELECT_ENTRY} WHERE e.id IN (${marks})`, ...idList);
    const photos = await r.getAllAsync<PhotoRow>(`SELECT * FROM photos WHERE entry_id IN (${marks}) ORDER BY sort, id`, ...idList);
    const byEntry = new Map<number, Photo[]>();
    for (const p of photos) byEntry.set(p.entry_id, [...(byEntry.get(p.entry_id) ?? []), toPhoto(p)]);
    const byId = new Map(rows.map((row) => [row.id, toEntry(row, byEntry.get(row.id) ?? [])]));
    return idList.map((id) => byId.get(id)).filter((e): e is Entry => !!e);
  });
}

export type SearchFilter = { from?: DateStr; to?: DateStr; levels?: readonly number[]; activityId?: number | null };

/** Id, title and note of the entries matching the filters, newest first (the text match runs in src/engine/search.ts). */
export async function searchCandidates(db: Db, filter: SearchFilter): Promise<{ id: number; noteTitle: string; note: string }[]> {
  const where: string[] = ['e.local_date >= ?', 'e.local_date <= ?'];
  const args: (string | number)[] = [filter.from ?? '0000-00-00', filter.to ?? '9999-99-99'];
  if (filter.levels && filter.levels.length) {
    where.push(`m.level IN (${filter.levels.map(() => '?').join(',')})`);
    args.push(...filter.levels);
  }
  if (filter.activityId) {
    where.push('EXISTS (SELECT 1 FROM entry_activities ea WHERE ea.entry_id = e.id AND ea.activity_id = ?)');
    args.push(filter.activityId);
  }
  const rows = await withRead(db, (r) =>
    r.getAllAsync<{ id: number; note_title: string; note: string }>(
      `SELECT e.id, e.note_title, e.note FROM entries e JOIN moods m ON m.id = e.mood_id WHERE ${where.join(' AND ')}
        ORDER BY e.local_date DESC, e.utc_ms DESC, e.id DESC`,
      ...args
    )
  );
  return rows.map((r) => ({ id: r.id, noteTitle: r.note_title, note: r.note }));
}
