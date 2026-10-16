// Goals on an activity (SPEC Goals, Formula 13). Unlimited. Day goals always have target 1. Progress, streak and
// success rate come from src/engine/goals.ts; this module only stores the definition.
import { isValidDate, type DateStr, type GoalPeriod } from '@/engine/dates';

import { DataRuleError } from './errors';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type Goal = {
  id: number;
  activityId: number;
  period: GoalPeriod;
  target: number;
  startDate: DateStr;
  archived: boolean;
  /** The activity is archived → the goal is paused (no instances counted). */
  activityArchived: boolean;
};

export type GoalInput = { activityId: number; period: GoalPeriod; target: number; startDate: DateStr };

type GoalRow = { id: number; activity_id: number; period: GoalPeriod; target: number; start_date: string; archived: number; activity_archived: number };

const PERIODS: readonly GoalPeriod[] = ['day', 'week', 'month'];

function clean(input: GoalInput): GoalInput {
  if (!PERIODS.includes(input.period)) throw new DataRuleError('invalid', `period ${input.period}`);
  if (!isValidDate(input.startDate)) throw new DataRuleError('invalid', `start ${input.startDate}`);
  const target = input.period === 'day' ? 1 : input.target;
  if (!Number.isInteger(target) || target < 1 || target > (input.period === 'week' ? 7 : 31)) throw new DataRuleError('invalid', `target ${input.target}`);
  return { ...input, target };
}

async function requireActivity(tx: Db, id: number) {
  const a = await tx.getFirstAsync<{ id: number }>('SELECT id FROM activities WHERE id = ?', id);
  if (!a) throw new DataRuleError('not-found', `activity ${id}`);
}

export async function addGoal(db: Db, raw: GoalInput, now: number): Promise<number> {
  const input = clean(raw);
  return withTransaction(db, async (tx) => {
    await requireActivity(tx, input.activityId);
    const r = await tx.runAsync(
      'INSERT INTO goals (activity_id, period, target, start_date, created_ms) VALUES (?, ?, ?, ?, ?)',
      input.activityId,
      input.period,
      input.target,
      input.startDate,
      now
    );
    return r.lastInsertRowId;
  });
}

export async function updateGoal(db: Db, id: number, raw: GoalInput): Promise<void> {
  const input = clean(raw);
  return withTransaction(db, async (tx) => {
    await requireActivity(tx, input.activityId);
    const r = await tx.runAsync(
      'UPDATE goals SET activity_id = ?, period = ?, target = ?, start_date = ? WHERE id = ?',
      input.activityId,
      input.period,
      input.target,
      input.startDate,
      id
    );
    if (r.changes === 0) throw new DataRuleError('not-found', `goal ${id}`);
  });
}

export async function setGoalArchived(db: Db, id: number, archived: boolean): Promise<void> {
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE goals SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
    if (r.changes === 0) throw new DataRuleError('not-found', `goal ${id}`);
  });
}

export async function deleteGoal(db: Db, id: number): Promise<void> {
  return withTransaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM goals WHERE id = ?', id);
  });
}

export async function listGoals(db: Db, opts: { includeArchived?: boolean } = {}): Promise<Goal[]> {
  const where = opts.includeArchived ? '' : 'WHERE g.archived = 0';
  const rows = await withRead(db, (r) =>
    r.getAllAsync<GoalRow>(
      `SELECT g.id, g.activity_id, g.period, g.target, g.start_date, g.archived, a.archived AS activity_archived
         FROM goals g JOIN activities a ON a.id = g.activity_id ${where} ORDER BY g.id`
    )
  );
  return rows.map((r) => ({
    id: r.id,
    activityId: r.activity_id,
    period: r.period,
    target: r.target,
    startDate: r.start_date,
    archived: r.archived === 1,
    activityArchived: r.activity_archived === 1,
  }));
}

/** Journal days with ≥ 1 entry containing the activity (input of src/engine/goals.ts). */
export async function daysWithActivity(db: Db, activityId: number): Promise<DateStr[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<{ d: string }>(
      'SELECT DISTINCT e.local_date AS d FROM entries e JOIN entry_activities ea ON ea.entry_id = e.id WHERE ea.activity_id = ? ORDER BY d',
      activityId
    )
  );
  return rows.map((r) => r.d);
}
