// Formula 4 — chart series: v(d) per logged day for periods ≤ 92 days, week means (by week_start) for ≤ 731 days
// (D39), month means beyond. Only logged days inside the period count; buckets without days are absent (gaps).
import { periodLength, weekStartOf, type DateStr, type WeekStart } from '../dates';

import type { DayInfo } from './days';
import { meanOf, type Period } from './types';

export type SeriesMode = 'day' | 'week' | 'month';
/** `key` = the day, the week's first day, or 'YYYY-MM'. */
export type SeriesPoint = { key: string; value: number; n: number };

export const DAILY_MAX_DAYS = 92;
export const WEEKLY_MAX_DAYS = 731;

export function seriesMode(period: Period): SeriesMode {
  const length = periodLength(period.start, period.end);
  return length <= DAILY_MAX_DAYS ? 'day' : length <= WEEKLY_MAX_DAYS ? 'week' : 'month';
}

export function moodSeries(days: Map<DateStr, DayInfo>, period: Period, weekStart: WeekStart): { mode: SeriesMode; points: SeriesPoint[] } {
  const mode = seriesMode(period);
  const key = mode === 'day' ? (d: DateStr) => d : mode === 'week' ? (d: DateStr) => weekStartOf(d, weekStart) : (d: DateStr) => d.slice(0, 7);
  const acc = new Map<string, number[]>();
  for (const info of days.values()) {
    if (info.date < period.start || info.date > period.end) continue;
    const k = key(info.date);
    let list = acc.get(k);
    if (!list) acc.set(k, (list = []));
    list.push(info.value);
  }
  const points = [...acc.keys()].sort().map((k) => ({ key: k, value: meanOf(acc.get(k)!) as number, n: acc.get(k)!.length }));
  return { mode, points };
}
