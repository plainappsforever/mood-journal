// Review S2 / D54: streaks and goals use the JOURNAL day as "today" (SPEC F12/F13 clarification), not the calendar date.
import { journalToday, localToUtc, zoneOffsetFn } from './dates';
import { computeGoal } from './goals';
import { computeStreak } from './streaks';

const berlin = zoneOffsetFn('Europe/Berlin');

describe('"today" = the journal day when the day ends after midnight', () => {
  const now = localToUtc('2026-10-17', '00:30', berlin); // "My day ends at 3:00": still the journal day 2026-10-16

  it('journalToday', () => {
    expect(journalToday(now, berlin, 3)).toBe('2026-10-16');
    expect(journalToday(now, berlin, 0)).toBe('2026-10-17');
    expect(journalToday(localToUtc('2026-10-17', '03:00', berlin), berlin, 3)).toBe('2026-10-17');
    // DST night: 2026-10-25 02:30 happens twice in Berlin; both are before 3:00 → still 10-24
    expect(journalToday(Date.UTC(2026, 9, 25, 0, 30), berlin, 3)).toBe('2026-10-24');
    expect(journalToday(Date.UTC(2026, 9, 25, 1, 30), berlin, 3)).toBe('2026-10-24');
  });

  it('streak stays 3 at 00:30 instead of dropping to 0 (reviewer case)', () => {
    const logged = ['2026-10-13', '2026-10-14', '2026-10-15'];
    expect(computeStreak(logged, '2026-10-17').current).toBe(0); // the calendar date: what S2 reported
    expect(computeStreak(logged, journalToday(now, berlin, 3)).current).toBe(3);
  });

  it("yesterday's day goal is still the current, not-yet-failed instance", () => {
    const g = computeGoal({ period: 'day', target: 1, startDate: '2026-10-10', activityArchived: false }, ['2026-10-15'], journalToday(now, berlin, 3), 1);
    expect(g.current).toMatchObject({ start: '2026-10-16', complete: false, success: false });
    expect(g.instances.find((i) => i.start === '2026-10-16')!.complete).toBe(false);
  });
});
