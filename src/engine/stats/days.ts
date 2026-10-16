// Formula 1 — day value v(d) = mean level of the entries on d. Everything else is built on this index.
import { addDays, type DateStr } from '../dates';

import type { Period, StatEntry } from './types';

export type DayInfo = { date: DateStr; value: number; entries: number; activities: Set<number> };

/** The entries of `all` whose journal day lies in the period (only these count; SPEC Formulas). */
export function entriesIn(all: readonly StatEntry[], period: Period): StatEntry[] {
  return all.filter((e) => e.date >= period.start && e.date <= period.end);
}

/** Logged days of `entries` (already filtered to a period), sorted by date. */
export function dayIndex(entries: readonly StatEntry[]): Map<DateStr, DayInfo> {
  const acc = new Map<DateStr, { sum: number; n: number; acts: Set<number> }>();
  for (const e of entries) {
    let a = acc.get(e.date);
    if (!a) acc.set(e.date, (a = { sum: 0, n: 0, acts: new Set() }));
    a.sum += e.level;
    a.n++;
    for (const id of e.activityIds) a.acts.add(id);
  }
  const out = new Map<DateStr, DayInfo>();
  for (const date of [...acc.keys()].sort()) {
    const a = acc.get(date)!;
    out.set(date, { date, value: a.sum / a.n, entries: a.n, activities: a.acts });
  }
  return out;
}

/** v(d) for each logged day. */
export function dayValues(days: Map<DateStr, DayInfo>): Map<DateStr, number> {
  return new Map([...days].map(([d, info]) => [d, info.value]));
}

/** Consecutive logged day pairs (d, d + 1), both in the index (Formula 8, next-day mode). */
export function nextDayPairs(days: Map<DateStr, DayInfo>): [DayInfo, DayInfo][] {
  const out: [DayInfo, DayInfo][] = [];
  for (const info of days.values()) {
    const next = days.get(addDays(info.date, 1));
    if (next) out.push([info, next]);
  }
  return out;
}
