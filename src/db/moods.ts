// Moods: five fixed levels (5 = best), any number of named moods per level (D14). Each level always keeps at least
// one ACTIVE (non-archived) mood, so the Home row always has five faces.
import { DataRuleError } from './errors';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type Mood = {
  id: number;
  level: number;
  name: string;
  emoji: string;
  color: string;
  sort: number;
  archived: boolean;
  importRef: string | null;
};

type MoodRow = { id: number; level: number; name: string; emoji: string; color: string; sort: number; archived: number; import_ref: string | null };

const COLUMNS = 'id, level, name, emoji, color, sort, archived, import_ref';
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function toMood(r: MoodRow): Mood {
  return { id: r.id, level: r.level, name: r.name, emoji: r.emoji, color: r.color, sort: r.sort, archived: r.archived === 1, importRef: r.import_ref };
}

function checkLevel(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new DataRuleError('invalid', `level ${level}`);
}

export type MoodInput = { level: number; name: string; emoji: string; color: string; importRef?: string | null };

function checkInput(input: Pick<MoodInput, 'name' | 'color'>) {
  if (!input.name.trim()) throw new DataRuleError('invalid', 'empty name');
  if (!COLOR_RE.test(input.color)) throw new DataRuleError('invalid', `color ${input.color}`);
}

/** Best level first; inside a level by `sort`, then id. */
export async function listMoods(db: Db, opts: { includeArchived?: boolean } = {}): Promise<Mood[]> {
  const where = opts.includeArchived ? '' : 'WHERE archived = 0';
  const rows = await withRead(db, (r) => r.getAllAsync<MoodRow>(`SELECT ${COLUMNS} FROM moods ${where} ORDER BY level DESC, sort, id`));
  return rows.map(toMood);
}

export async function getMood(db: Db, id: number): Promise<Mood | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<MoodRow>(`SELECT ${COLUMNS} FROM moods WHERE id = ?`, id));
  return row ? toMood(row) : null;
}

export async function addMood(db: Db, input: MoodInput, now: number): Promise<number> {
  checkLevel(input.level);
  checkInput(input);
  return withTransaction(db, async (tx) => {
    const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM moods WHERE level = ?', input.level);
    const { lastInsertRowId } = await tx.runAsync(
      'INSERT INTO moods (level, name, emoji, color, sort, created_ms, import_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.level,
      input.name.trim(),
      input.emoji,
      input.color,
      (max?.s ?? -1) + 1,
      now,
      input.importRef ?? null
    );
    return lastInsertRowId;
  });
}

export async function updateMood(db: Db, id: number, input: { name: string; emoji: string; color: string }): Promise<void> {
  checkInput(input);
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE moods SET name = ?, emoji = ?, color = ? WHERE id = ?', input.name.trim(), input.emoji, input.color, id);
    if (r.changes === 0) throw new DataRuleError('not-found', `mood ${id}`);
  });
}

export async function countEntriesForMood(db: Db, id: number): Promise<number> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM entries WHERE mood_id = ?', id));
  return row?.n ?? 0;
}

async function requireOtherActive(tx: Db, mood: MoodRow) {
  const row = await tx.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM moods WHERE level = ? AND archived = 0 AND id <> ?',
    mood.level,
    mood.id
  );
  if (!row?.n) throw new DataRuleError('last-of-level', `level ${mood.level}`);
}

async function load(tx: Db, id: number): Promise<MoodRow> {
  const row = await tx.getFirstAsync<MoodRow>(`SELECT ${COLUMNS} FROM moods WHERE id = ?`, id);
  if (!row) throw new DataRuleError('not-found', `mood ${id}`);
  return row;
}

/**
 * Moves a mood to another level. Its entries follow (their level comes from the mood), so the screen confirms with
 * `countEntriesForMood` first. Returns the number of re-levelled entries.
 */
export async function setMoodLevel(db: Db, id: number, level: number): Promise<number> {
  checkLevel(level);
  return withTransaction(db, async (tx) => {
    const mood = await load(tx, id);
    if (mood.level === level) return 0;
    if (!mood.archived) await requireOtherActive(tx, mood);
    const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM moods WHERE level = ?', level);
    await tx.runAsync('UPDATE moods SET level = ?, sort = ? WHERE id = ?', level, (max?.s ?? -1) + 1, id);
    const n = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM entries WHERE mood_id = ?', id);
    return n?.n ?? 0;
  });
}

/** Archive hides a mood from the pickers; history and stats keep it. The last active mood of a level stays. */
export async function setMoodArchived(db: Db, id: number, archived: boolean): Promise<void> {
  return withTransaction(db, async (tx) => {
    const mood = await load(tx, id);
    if (archived && !mood.archived) await requireOtherActive(tx, mood);
    await tx.runAsync('UPDATE moods SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
  });
}

/** Deleting a mood = moving its entries to another mood, then removing it (SPEC Edge cases). Returns entries moved. */
export async function mergeMood(db: Db, fromId: number, intoId: number, now: number): Promise<number> {
  if (fromId === intoId) return Promise.reject(new DataRuleError('same-mood'));
  return withTransaction(db, async (tx) => {
    const from = await load(tx, fromId);
    await load(tx, intoId);
    if (!from.archived) await requireOtherActive(tx, from);
    const moved = await tx.runAsync('UPDATE entries SET mood_id = ?, updated_ms = ? WHERE mood_id = ?', intoId, now, fromId);
    await tx.runAsync('DELETE FROM moods WHERE id = ?', fromId);
    return moved.changes;
  });
}

/** Reorders inside a level: swaps with the neighbour above (-1) or below (+1). */
export async function moveMood(db: Db, id: number, direction: -1 | 1): Promise<void> {
  return withTransaction(db, async (tx) => {
    const mood = await load(tx, id);
    const siblings = await tx.getAllAsync<{ id: number }>('SELECT id FROM moods WHERE level = ? ORDER BY sort, id', mood.level);
    const i = siblings.findIndex((s) => s.id === id);
    const j = i + direction;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    for (const [sort, s] of siblings.entries()) await tx.runAsync('UPDATE moods SET sort = ? WHERE id = ?', sort, s.id);
  });
}
