/**
 * @jest-environment node
 */
// The engines must not read the device/process zone (V1_PLAN Architecture: zone and "today" are parameters, D38).
import { addDays, journalDayOf, localToUtc, utcForJournalTime, zoneOffsetFn } from './dates';
import { computeGoal } from './goals';
import { overview, yearPixels, type StatEntry } from './stats';
import { computeStreak } from './streaks';

function compute() {
  const berlin = zoneOffsetFn('Europe/Berlin');
  const ny = zoneOffsetFn('America/New_York');
  const entries: StatEntry[] = [];
  for (let i = 0; i < 400; i++) entries.push({ id: i, moodId: 1, level: 1 + (i % 5), date: addDays('2024-01-01', Math.floor(i / 2)), activityIds: i % 3 ? [1] : [2] });
  const o = overview(entries, { start: '2024-01-01', end: '2024-12-31' }, 7, [1, 2]);
  return JSON.stringify({
    jd: [journalDayOf(Date.UTC(2026, 2, 29, 0, 30), berlin, 2), journalDayOf(Date.UTC(2026, 10, 1, 6, 30), ny, 2)],
    edit: [utcForJournalTime('2026-03-28', '02:30', 4, berlin), localToUtc('2026-11-01', '01:30', ny)],
    streak: computeStreak(entries.map((e) => e.date), '2024-07-10'),
    goal: computeGoal({ period: 'week', target: 3, startDate: '2024-02-01', activityArchived: false }, entries.filter((e) => e.activityIds.includes(1)).map((e) => e.date), '2024-06-01', 6),
    o: { ...o, monthly: [...o.monthly], yearly: [...o.yearly], pixels: [...o.pixels], frequency: [...o.frequency], counts: [...o.counts.byMood] },
    px: yearPixels(entries, 2024).months.map((m) => m.map((c) => c.level).join('')),
  });
}

describe('engines are independent of the process time zone', () => {
  // Every Date method that reads the process zone throws while the engines run. Jest's sandboxed process.env cannot
  // re-zone the worker, so poisoning the local-time API is the stronger proof: one call anywhere fails the test.
  const LOCAL = [
    'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds',
    'getTimezoneOffset', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds',
    'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toString', 'toDateString', 'toTimeString',
  ] as const;
  const proto = Date.prototype as unknown as Record<string, unknown>;
  const saved = new Map(LOCAL.map((k) => [k, proto[k]]));
  afterEach(() => {
    for (const [k, fn] of saved) proto[k] = fn;
  });

  it('no engine calls a local-time Date method', () => {
    const clean = compute();
    for (const k of LOCAL) {
      proto[k] = () => {
        throw new Error(`engine used Date.prototype.${k}`);
      };
    }
    expect(() => new Date(0).getHours()).toThrow(/getHours/); // the poison is active
    expect(compute()).toBe(clean);
  });
});
