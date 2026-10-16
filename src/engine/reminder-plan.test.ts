import { makeT } from '@/lib/i18n';

import { zoneOffsetFn } from './dates';
import { inQuietHours, planReminders, type PlanInput, type PlanReminder } from './reminder-plan';

const berlin = zoneOffsetFn('Europe/Berlin');
const newYork = zoneOffsetFn('America/New_York');
const at = (s: string) => Date.parse(s); // with explicit offset
const r = (id: number, hour: number, minute = 0, weekdays = 127, enabled = true): PlanReminder => ({ id, hour, minute, weekdays, enabled });
const t = makeT('en');

function plan(over: Partial<PlanInput>) {
  return planReminders({
    reminders: [r(1, 20)],
    nowMs: at('2026-10-16T12:00:00+02:00'), // Friday
    offsetAt: berlin,
    dayEndHour: 0,
    skipIfLogged: true,
    entriesMadeOn: () => [],
    title: t('reminder.title'),
    body: t('reminder.body'),
    ...over,
  });
}

describe('reminder planner', () => {
  it('one reminder: one notification per day from today, deterministic ids, default text without journal content', () => {
    const p = plan({});
    expect(p.scheduled[0]).toMatchObject({ identifier: 'mood-r1-2026-10-16', date: '2026-10-16', time: '20:00', journalDate: '2026-10-16', title: 'Mood', body: 'How was your day?' });
    expect(p.scheduled).toHaveLength(31); // today + 30 days
    expect(new Set(p.scheduled.map((s) => s.identifier)).size).toBe(31);
    expect(plan({}).scheduled).toEqual(p.scheduled); // same input, same plan
    expect(new Set(p.scheduled.map((s) => s.body))).toEqual(new Set(['How was your day?']));
  });

  it('6 reminders on all weekdays keep only the soonest 48 (A8)', () => {
    const p = plan({ reminders: [8, 10, 12, 14, 18, 21].map((h, i) => r(i + 1, h)) });
    expect(p.scheduled).toHaveLength(48);
    expect(p.truncated).toBe(true);
    expect(p.scheduled[0]).toMatchObject({ time: '14:00', date: '2026-10-16' }); // now = 12:00: 8, 10 and 12 o'clock are not in the future
    expect(p.scheduled.every((s, i) => i === 0 || s.utcMs > p.scheduled[i - 1].utcMs)).toBe(true);
  });

  it('weekdays bitmask: bit 0 = Monday … bit 6 = Sunday; disabled reminders are not planned', () => {
    const weekend = 0b1100000;
    const p = plan({ reminders: [r(1, 9, 30, weekend), r(2, 7, 0, 127, false)], horizonDays: 7 });
    expect(p.scheduled.map((s) => s.date)).toEqual(['2026-10-17', '2026-10-18']);
  });

  it('skip if logged: an entry made today skips today; with two reminders only since the previous one', () => {
    const made = at('2026-10-16T09:00:00+02:00');
    const entriesMadeOn = (d: string) => (d === '2026-10-16' ? [made] : []);
    expect(plan({ entriesMadeOn }).scheduled[0].date).toBe('2026-10-17');
    expect(plan({ entriesMadeOn }).skippedLogged).toBe(1);
    expect(plan({ entriesMadeOn, skipIfLogged: false }).scheduled[0].date).toBe('2026-10-16');
    // 13:00 and 20:00: the 09:00 entry (before 13:00, made this morning) skips 13:00 only
    const two = plan({ reminders: [r(1, 13), r(2, 20)], nowMs: at('2026-10-16T10:00:00+02:00'), entriesMadeOn });
    expect(two.scheduled.slice(0, 2).map((s) => [s.date, s.time])).toEqual([
      ['2026-10-16', '20:00'],
      ['2026-10-17', '13:00'],
    ]);
    // an entry made at 14:00 (after the 13:00 reminder) skips 20:00
    const after = plan({ reminders: [r(1, 13), r(2, 20)], nowMs: at('2026-10-16T14:30:00+02:00'), entriesMadeOn: (d) => (d === '2026-10-16' ? [at('2026-10-16T14:00:00+02:00')] : []) });
    expect(after.scheduled[0]).toMatchObject({ date: '2026-10-17', time: '13:00' });
  });

  it('day-end hour: a 00:30 reminder asks about the previous journal day', () => {
    const p = plan({ reminders: [r(1, 0, 30)], dayEndHour: 2, nowMs: at('2026-10-16T22:00:00+02:00'), entriesMadeOn: (d) => (d === '2026-10-16' ? [at('2026-10-16T21:00:00+02:00')] : []) });
    // 00:30 on 17 Oct belongs to journal day 16 Oct, which was logged at 21:00 → skipped
    expect(p.scheduled[0]).toMatchObject({ date: '2026-10-18', time: '00:30', journalDate: '2026-10-17' });
  });

  it('DST: a non-existent time fires at the first valid minute after it; a repeated time fires once', () => {
    const spring = plan({ reminders: [r(1, 2, 30)], nowMs: at('2026-03-28T12:00:00+01:00'), horizonDays: 2 });
    expect(spring.scheduled.map((s) => [s.identifier, s.date, s.time])).toEqual([
      ['mood-r1-2026-03-29', '2026-03-29', '03:00'],
      ['mood-r1-2026-03-30', '2026-03-30', '02:30'],
    ]);
    const fall = plan({ reminders: [r(1, 2, 30)], nowMs: at('2026-10-24T12:00:00+02:00'), horizonDays: 1 });
    expect(fall.scheduled.map((s) => new Date(s.utcMs).toISOString())).toEqual(['2026-10-25T00:30:00.000Z']); // first 02:30 (CEST)
    // New York spring forward 8 Mar 2026: 02:15 → 03:00 EDT
    const ny = plan({ reminders: [r(1, 2, 15)], offsetAt: newYork, nowMs: at('2026-03-07T12:00:00-05:00'), horizonDays: 1 });
    expect(ny.scheduled.map((s) => s.time)).toEqual(['03:00']);
  });

  it('two reminders that land on the same moment (spring-forward gap) notify once', () => {
    const p = plan({ reminders: [r(1, 2, 15), r(2, 2, 45)], nowMs: at('2026-03-28T12:00:00+01:00'), horizonDays: 1 });
    expect(p.scheduled.filter((s) => s.date === '2026-03-29').map((s) => s.identifier)).toEqual(['mood-r1-2026-03-29']);
  });

  it('a zone change re-plans to the same wall-clock time in the new zone', () => {
    const now = at('2026-10-16T12:00:00+02:00');
    const b = plan({ nowMs: now });
    const n = plan({ nowMs: now, offsetAt: newYork });
    expect(n.scheduled[0]).toMatchObject({ date: '2026-10-16', time: '20:00' });
    expect(n.scheduled[0].utcMs - b.scheduled[0].utcMs).toBe(6 * 3_600_000);
  });

  it('quiet hours drop moments inside the window (also across midnight)', () => {
    expect(inQuietHours('23:00', { start: '22:00', end: '07:00' })).toBe(true);
    expect(inQuietHours('06:59', { start: '22:00', end: '07:00' })).toBe(true);
    expect(inQuietHours('07:00', { start: '22:00', end: '07:00' })).toBe(false);
    expect(inQuietHours('12:00', { start: '12:00', end: '13:00' })).toBe(true);
    const p = plan({ reminders: [r(1, 23), r(2, 20)], quietHours: { start: '22:00', end: '07:00' }, horizonDays: 2 });
    expect(p.scheduled.map((s) => s.time)).toEqual(['20:00', '20:00', '20:00']);
    expect(p.droppedQuiet).toBe(3);
  });

  it('the user’s own text is used as is; nothing else reaches the notification', () => {
    const p = plan({ body: 'Check in?' });
    expect(Object.keys(p.scheduled[0]).sort()).toEqual(['body', 'date', 'identifier', 'journalDate', 'reminderId', 'time', 'title', 'utcMs']);
    expect(p.scheduled[0].body).toBe('Check in?');
  });
});
