// Activity groups and activities (SPEC Data model; Edge cases "Deleted / archived activities"). Archive hides from
// the picker and keeps history, stats and (paused) goals. Delete removes the activity from its entries and deletes
// the goals on it (D34), after the screen showed both counts.
import { DataRuleError } from './errors';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type ActivityGroup = { id: number; name: string; sort: number; archived: boolean; importRef: string | null };
export type Activity = {
  id: number;
  groupId: number;
  name: string;
  emoji: string;
  sort: number;
  archived: boolean;
  importRef: string | null;
};

type GroupRow = { id: number; name: string; sort: number; archived: number; import_ref: string | null };
type ActivityRow = { id: number; group_id: number; name: string; emoji: string; sort: number; archived: number; import_ref: string | null };

const toGroup = (r: GroupRow): ActivityGroup => ({ id: r.id, name: r.name, sort: r.sort, archived: r.archived === 1, importRef: r.import_ref });
const toActivity = (r: ActivityRow): Activity => ({
  id: r.id,
  groupId: r.group_id,
  name: r.name,
  emoji: r.emoji,
  sort: r.sort,
  archived: r.archived === 1,
  importRef: r.import_ref,
});

function cleanName(name: string): string {
  const n = name.trim();
  if (!n) throw new DataRuleError('invalid', 'empty name');
  return n;
}

export async function listGroups(db: Db, opts: { includeArchived?: boolean } = {}): Promise<ActivityGroup[]> {
  const where = opts.includeArchived ? '' : 'WHERE archived = 0';
  const rows = await withRead(db, (r) => r.getAllAsync<GroupRow>(`SELECT id, name, sort, archived, import_ref FROM activity_groups ${where} ORDER BY sort, id`));
  return rows.map(toGroup);
}

export async function addGroup(db: Db, name: string, now: number, importRef: string | null = null): Promise<number> {
  const clean = cleanName(name);
  return withTransaction(db, async (tx) => {
    const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM activity_groups');
    const r = await tx.runAsync(
      'INSERT INTO activity_groups (name, sort, created_ms, import_ref) VALUES (?, ?, ?, ?)',
      clean,
      (max?.s ?? -1) + 1,
      now,
      importRef
    );
    return r.lastInsertRowId;
  });
}

export async function renameGroup(db: Db, id: number, name: string): Promise<void> {
  const clean = cleanName(name);
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE activity_groups SET name = ? WHERE id = ?', clean, id);
    if (r.changes === 0) throw new DataRuleError('not-found', `group ${id}`);
  });
}

export async function setGroupArchived(db: Db, id: number, archived: boolean): Promise<void> {
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE activity_groups SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
    if (r.changes === 0) throw new DataRuleError('not-found', `group ${id}`);
  });
}

/** Only an empty group can be deleted (archive the others). */
export async function deleteGroup(db: Db, id: number): Promise<void> {
  return withTransaction(db, async (tx) => {
    const n = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM activities WHERE group_id = ?', id);
    if (n?.n) throw new DataRuleError('group-not-empty', `group ${id}`);
    await tx.runAsync('DELETE FROM activity_groups WHERE id = ?', id);
  });
}

async function swapSort(tx: Db, table: 'activity_groups' | 'activities', ids: number[], id: number, direction: -1 | 1) {
  const i = ids.indexOf(id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (const [sort, rowId] of ids.entries()) await tx.runAsync(`UPDATE ${table} SET sort = ? WHERE id = ?`, sort, rowId);
}

export async function moveGroup(db: Db, id: number, direction: -1 | 1): Promise<void> {
  return withTransaction(db, async (tx) => {
    const rows = await tx.getAllAsync<{ id: number }>('SELECT id FROM activity_groups ORDER BY sort, id');
    await swapSort(
      tx,
      'activity_groups',
      rows.map((r) => r.id),
      id,
      direction
    );
  });
}

export async function listActivities(db: Db, opts: { includeArchived?: boolean } = {}): Promise<Activity[]> {
  const where = opts.includeArchived ? '' : 'WHERE a.archived = 0';
  const rows = await withRead(db, (r) =>
    r.getAllAsync<ActivityRow>(
      `SELECT a.id, a.group_id, a.name, a.emoji, a.sort, a.archived, a.import_ref
         FROM activities a JOIN activity_groups g ON g.id = a.group_id ${where}
        ORDER BY g.sort, g.id, a.sort, a.id`
    )
  );
  return rows.map(toActivity);
}

export type ActivityInput = { groupId: number; name: string; emoji: string; importRef?: string | null };

function isUniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((error as Error)?.message ?? error));
}

export async function addActivity(db: Db, input: ActivityInput, now: number): Promise<number> {
  const name = cleanName(input.name);
  return withTransaction(db, async (tx) => {
    const group = await tx.getFirstAsync<{ id: number }>('SELECT id FROM activity_groups WHERE id = ?', input.groupId);
    if (!group) throw new DataRuleError('not-found', `group ${input.groupId}`);
    const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM activities WHERE group_id = ?', input.groupId);
    try {
      const r = await tx.runAsync(
        'INSERT INTO activities (group_id, name, emoji, sort, created_ms, import_ref) VALUES (?, ?, ?, ?, ?, ?)',
        input.groupId,
        name,
        input.emoji,
        (max?.s ?? -1) + 1,
        now,
        input.importRef ?? null
      );
      return r.lastInsertRowId;
    } catch (error) {
      if (isUniqueViolation(error)) throw new DataRuleError('duplicate-name', name);
      throw error;
    }
  });
}

/** Rename / new emoji / move to another group (appended at its end). */
export async function updateActivity(db: Db, id: number, input: { groupId: number; name: string; emoji: string }): Promise<void> {
  const name = cleanName(input.name);
  return withTransaction(db, async (tx) => {
    const current = await tx.getFirstAsync<ActivityRow>('SELECT * FROM activities WHERE id = ?', id);
    if (!current) throw new DataRuleError('not-found', `activity ${id}`);
    let sort = current.sort;
    if (current.group_id !== input.groupId) {
      const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM activities WHERE group_id = ?', input.groupId);
      sort = (max?.s ?? -1) + 1;
    }
    try {
      await tx.runAsync('UPDATE activities SET group_id = ?, name = ?, emoji = ?, sort = ? WHERE id = ?', input.groupId, name, input.emoji, sort, id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DataRuleError('duplicate-name', name);
      throw error;
    }
  });
}

export async function moveActivity(db: Db, id: number, direction: -1 | 1): Promise<void> {
  return withTransaction(db, async (tx) => {
    const current = await tx.getFirstAsync<{ group_id: number }>('SELECT group_id FROM activities WHERE id = ?', id);
    if (!current) throw new DataRuleError('not-found', `activity ${id}`);
    const rows = await tx.getAllAsync<{ id: number }>('SELECT id FROM activities WHERE group_id = ? ORDER BY sort, id', current.group_id);
    await swapSort(
      tx,
      'activities',
      rows.map((r) => r.id),
      id,
      direction
    );
  });
}

export async function setActivityArchived(db: Db, id: number, archived: boolean): Promise<void> {
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE activities SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
    if (r.changes === 0) throw new DataRuleError('not-found', `activity ${id}`);
  });
}

/** What a delete would affect ("Used in 42 entries and 1 goal — remove it from them?"). */
export async function activityUsage(db: Db, id: number): Promise<{ entries: number; goals: number }> {
  return withRead(db, async (r) => {
    const e = await r.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM entry_activities WHERE activity_id = ?', id);
    const g = await r.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM goals WHERE activity_id = ?', id);
    return { entries: e?.n ?? 0, goals: g?.n ?? 0 };
  });
}

/** Removes the activity from its entries, deletes its goals and the activity, in one transaction. */
export async function deleteActivity(db: Db, id: number): Promise<{ entries: number; goals: number }> {
  return withTransaction(db, async (tx) => {
    const found = await tx.getFirstAsync<{ id: number }>('SELECT id FROM activities WHERE id = ?', id);
    if (!found) throw new DataRuleError('not-found', `activity ${id}`);
    const e = await tx.runAsync('DELETE FROM entry_activities WHERE activity_id = ?', id);
    const g = await tx.runAsync('DELETE FROM goals WHERE activity_id = ?', id);
    await tx.runAsync('DELETE FROM activities WHERE id = ?', id);
    return { entries: e.changes, goals: g.changes };
  });
}
