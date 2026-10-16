// Statistics engine (SPEC Formulas 1–11, D15). PURE: entries, the period, week start and "today" are parameters.
// Mapping of functions to formula numbers: README.md in this folder.
import type { DateStr, WeekStart } from '../dates';

import { compareEntries, compareNextDay, compareSameDay, type Comparison } from './compare';
import { dayIndex, entriesIn, nextDayPairs, type DayInfo } from './days';
import { pixelLevels } from './pixels';
import { moodSeries, type SeriesMode, type SeriesPoint } from './series';
import { averageMood, byMonth, byWeekday, byYear, moodCounts, type Average, type MoodCounts } from './summary';
import { frequencies, oftenTogether, relatedForLevel, topPairs, type Frequency, type Pair, type TogetherRow } from './together';
import type { Mean, Period, StatEntry } from './types';

export * from './compare';
export * from './days';
export * from './format';
export * from './pixels';
export * from './series';
export * from './summary';
export * from './together';
export * from './types';

/** A period's entries, day index and next-day pairs, built once and shared by every card and detail. */
export type PeriodData = { period: Period; entries: StatEntry[]; days: Map<DateStr, DayInfo>; pairs: [DayInfo, DayInfo][] };

export function preparePeriod(all: readonly StatEntry[], period: Period): PeriodData {
  const entries = entriesIn(all, period);
  const days = dayIndex(entries);
  return { period, entries, days, pairs: nextDayPairs(days) };
}

export type Overview = {
  period: Period;
  /** Reuse for activityDetail / levelDetail of the same period. */
  data: PeriodData;
  average: Average;
  counts: MoodCounts;
  series: { mode: SeriesMode; points: SeriesPoint[] };
  weekday: Mean[];
  monthly: Map<string, Mean>;
  yearly: Map<string, Mean>;
  pixels: Map<DateStr, number>;
  topPairs: Pair[];
  frequency: Map<number, Frequency>;
};

/** Everything the Stats screen shows for a period, from all entries (`all`) in one pass per card. */
export function overview(all: readonly StatEntry[], period: Period, weekStart: WeekStart, activityIds: readonly number[]): Overview {
  const data = preparePeriod(all, period);
  const { entries: inP, days } = data;
  return {
    period,
    data,
    average: averageMood(days),
    counts: moodCounts(inP),
    series: moodSeries(days, period, weekStart),
    weekday: byWeekday(days),
    monthly: byMonth(days),
    yearly: byYear(days),
    pixels: pixelLevels(days),
    topPairs: topPairs(inP),
    frequency: frequencies(all, period, activityIds),
  };
}

export type ActivityDetail = { entries: Comparison; sameDay: Comparison; nextDay: Comparison; together: TogetherRow[]; counts: MoodCounts };

/** Activity detail screen: three comparisons, often together, and mood counts of the entries with the activity. */
export function activityDetail(data: PeriodData, activityId: number): ActivityDetail {
  const { entries: inP, days, pairs } = data;
  return {
    entries: compareEntries(inP, activityId),
    sameDay: compareSameDay(days, activityId),
    nextDay: compareNextDay(days, activityId, pairs),
    together: oftenTogether(inP, activityId),
    counts: moodCounts(inP.filter((e) => e.activityIds.includes(activityId))),
  };
}

/** Level detail screen: related activities (Formula 10). */
export function levelDetail(data: PeriodData, level: number): TogetherRow[] {
  return relatedForLevel(data.entries, level);
}
