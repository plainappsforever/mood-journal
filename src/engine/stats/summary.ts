// Formulas 2, 3, 5, 6 — average (day-weighted), counts (entry-weighted), by weekday, monthly / yearly.
import { isoWeekday, type DateStr } from '../dates';

import type { DayInfo } from './days';
import { meanOf, roundOneDecimal, type Mean, type StatEntry } from './types';

export type Average = { value: number | null; rounded: number | null; days: number; entries: number };

/** Formula 2: mean of v(d) over logged days (a day with six check-ins weighs as much as a day with one). */
export function averageMood(days: Map<DateStr, DayInfo>): Average {
  const values = [...days.values()].map((d) => d.value);
  const value = meanOf(values);
  let entries = 0;
  for (const d of days.values()) entries += d.entries;
  return { value, rounded: value === null ? null : roundOneDecimal(value), days: values.length, entries };
}

export type MoodCounts = { byMood: Map<number, number>; byLevel: Record<1 | 2 | 3 | 4 | 5, number> };

/** Formula 3: entries per mood and per level. */
export function moodCounts(entries: readonly StatEntry[]): MoodCounts {
  const byMood = new Map<number, number>();
  const byLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const e of entries) {
    byMood.set(e.moodId, (byMood.get(e.moodId) ?? 0) + 1);
    byLevel[e.level as 1 | 2 | 3 | 4 | 5]++;
  }
  return { byMood, byLevel };
}

function grouped(days: Map<DateStr, DayInfo>, key: (d: DateStr) => string): Map<string, Mean> {
  const acc = new Map<string, number[]>();
  for (const info of days.values()) {
    const k = key(info.date);
    let list = acc.get(k);
    if (!list) acc.set(k, (list = []));
    list.push(info.value);
  }
  return new Map([...acc.keys()].sort().map((k) => [k, { mean: meanOf(acc.get(k)!), n: acc.get(k)!.length }]));
}

/** Formula 5: mean v(d) per ISO weekday 1 (Monday) … 7 (Sunday), all seven present (n = 0 → mean null). */
export function byWeekday(days: Map<DateStr, DayInfo>): Mean[] {
  const g = grouped(days, (d) => String(isoWeekday(d)));
  return [1, 2, 3, 4, 5, 6, 7].map((w) => g.get(String(w)) ?? { mean: null, n: 0 });
}

/** Formula 6: per calendar month 'YYYY-MM'. */
export function byMonth(days: Map<DateStr, DayInfo>): Map<string, Mean> {
  return grouped(days, (d) => d.slice(0, 7));
}

/** Formula 6: per year 'YYYY'. */
export function byYear(days: Map<DateStr, DayInfo>): Map<string, Mean> {
  return grouped(days, (d) => d.slice(0, 4));
}
