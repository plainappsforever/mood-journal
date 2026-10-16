// Reminder times (SPEC Reminders, D21): up to 6, each with weekdays (bit 0 = Monday … bit 6 = Sunday). The schedule
// itself is planned by src/engine/reminder-plan.ts.
import { DataRuleError } from './errors';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export const MAX_REMINDERS = 6;
export const ALL_WEEKDAYS = 0b1111111;

export type Reminder = { id: number; hour: number; minute: number; weekdays: number; enabled: boolean; sort: number };
export type ReminderInput = { hour: number; minute: number; weekdays: number; enabled: boolean };

function check(input: ReminderInput) {
  const int = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(input.hour, 0, 23) || !int(input.minute, 0, 59) || !int(input.weekdays, 0, ALL_WEEKDAYS)) {
    throw new DataRuleError('invalid', `reminder ${input.hour}:${input.minute}/${input.weekdays}`);
  }
}

export async function listReminders(db: Db): Promise<Reminder[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<{ id: number; hour: number; minute: number; weekdays: number; enabled: number; sort: number }>(
      'SELECT id, hour, minute, weekdays, enabled, sort FROM reminders ORDER BY sort, id'
    )
  );
  return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }));
}

export async function addReminder(db: Db, input: ReminderInput): Promise<number> {
  check(input);
  return withTransaction(db, async (tx) => {
    const n = await tx.getFirstAsync<{ n: number; s: number | null }>('SELECT COUNT(*) AS n, MAX(sort) AS s FROM reminders');
    if ((n?.n ?? 0) >= MAX_REMINDERS) throw new DataRuleError('too-many-reminders');
    const r = await tx.runAsync(
      'INSERT INTO reminders (hour, minute, weekdays, enabled, sort) VALUES (?, ?, ?, ?, ?)',
      input.hour,
      input.minute,
      input.weekdays,
      input.enabled ? 1 : 0,
      (n?.s ?? -1) + 1
    );
    return r.lastInsertRowId;
  });
}

export async function updateReminder(db: Db, id: number, input: ReminderInput): Promise<void> {
  check(input);
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      'UPDATE reminders SET hour = ?, minute = ?, weekdays = ?, enabled = ? WHERE id = ?',
      input.hour,
      input.minute,
      input.weekdays,
      input.enabled ? 1 : 0,
      id
    );
    if (r.changes === 0) throw new DataRuleError('not-found', `reminder ${id}`);
  });
}

export async function deleteReminder(db: Db, id: number): Promise<void> {
  return withTransaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM reminders WHERE id = ?', id);
  });
}
