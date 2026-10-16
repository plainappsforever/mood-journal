// Formula 12 (SPEC): a day is logged if it has ≥ 1 entry (retroactive entries included). Current streak = run of
// logged days ending today if today is logged, else ending yesterday if yesterday is logged, else 0. Longest = the
// longest run anywhere in the history. PURE: `today` is a parameter.
import { dayNumber, type DateStr } from './dates';

export type Streak = { current: number; longest: number };

export function computeStreak(loggedDates: Iterable<DateStr>, today: DateStr): Streak {
  const days = new Set<number>();
  for (const d of loggedDates) days.add(dayNumber(d));
  const runEnding = (n: number) => {
    let length = 0;
    while (days.has(n - length)) length++;
    return length;
  };
  const t = dayNumber(today);
  const current = days.has(t) ? runEnding(t) : days.has(t - 1) ? runEnding(t - 1) : 0;
  let longest = 0;
  for (const n of days) if (!days.has(n + 1)) longest = Math.max(longest, runEnding(n));
  return { current, longest };
}
