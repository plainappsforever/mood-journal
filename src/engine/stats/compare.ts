// Formula 8 — activity comparison in three modes, each with counts and a plain-word label from Welch's t.
// Shown only if both n ≥ 3 ("Not enough data yet"); "few" while min(n) < 10; otherwise |t| ≥ 3 clear (owner decision
// on review S1, D52: with |t| ≥ 2 almost every journal showed a "clear difference" by chance), ≥ 1 small, < 1 no clear
// difference. Both variances 0: |t| = ∞ when Δ ≠ 0, else 0. Never causal wording (L26).
import type { DateStr } from '../dates';

import { nextDayPairs, type DayInfo } from './days';
import { EPS, meanOf, sampleVariance, type StatEntry } from './types';

export type CompareMode = 'entries' | 'sameDay' | 'nextDay';
export type CompareLabel = 'notEnough' | 'few' | 'clear' | 'small' | 'none';

export type Comparison = {
  mode: CompareMode;
  withMean: number | null;
  withN: number;
  withoutMean: number | null;
  withoutN: number;
  /** mean_with − mean_without (null when a side is empty). */
  delta: number | null;
  /** Welch t; only when both n ≥ 10; ±Infinity when both variances are 0 and Δ ≠ 0. */
  t: number | null;
  label: CompareLabel;
};

export const MIN_SHOWN = 3;
export const MIN_LABELLED = 10;
/** |t| from which a difference is called "clear" (D52) and "small". */
export const T_CLEAR = 3;
export const T_SMALL = 1;

/** The statistic for two samples. */
export function welch(withValues: readonly number[], withoutValues: readonly number[], mode: CompareMode): Comparison {
  const withN = withValues.length;
  const withoutN = withoutValues.length;
  const withMean = meanOf(withValues);
  const withoutMean = meanOf(withoutValues);
  const delta = withMean !== null && withoutMean !== null ? withMean - withoutMean : null;
  const base = { mode, withMean, withN, withoutMean, withoutN, delta, t: null };
  const minN = Math.min(withN, withoutN);
  if (minN < MIN_SHOWN) return { ...base, label: 'notEnough' };
  if (minN < MIN_LABELLED) return { ...base, label: 'few' };
  const d = delta as number;
  const v1 = sampleVariance(withValues);
  const v2 = sampleVariance(withoutValues);
  let t: number;
  if (v1 < EPS && v2 < EPS) {
    t = Math.abs(d) < EPS ? 0 : d > 0 ? Infinity : -Infinity;
  } else {
    t = Math.abs(d) < EPS ? 0 : d / Math.sqrt(v1 / withN + v2 / withoutN);
  }
  const a = Math.abs(t);
  const label: CompareLabel = a >= T_CLEAR - EPS ? 'clear' : a >= T_SMALL - EPS ? 'small' : 'none';
  return { ...base, t, label };
}

/** Entries mode (default): mean level of entries with the activity vs without; n = entries. */
export function compareEntries(entries: readonly StatEntry[], activityId: number): Comparison {
  const w: number[] = [];
  const wo: number[] = [];
  for (const e of entries) (e.activityIds.includes(activityId) ? w : wo).push(e.level);
  return welch(w, wo, 'entries');
}

/** Same day: mean v(d) over logged days having ≥ 1 entry with the activity vs logged days having none; n = days. */
export function compareSameDay(days: Map<DateStr, DayInfo>, activityId: number): Comparison {
  const w: number[] = [];
  const wo: number[] = [];
  for (const info of days.values()) (info.activities.has(activityId) ? w : wo).push(info.value);
  return welch(w, wo, 'sameDay');
}

/** Next day: pairs (d, d+1) both logged and in P; mean v(d+1) where d has the activity vs where d lacks it; n = pairs. */
export function compareNextDay(days: Map<DateStr, DayInfo>, activityId: number, pairs = nextDayPairs(days)): Comparison {
  const w: number[] = [];
  const wo: number[] = [];
  for (const [day, next] of pairs) (day.activities.has(activityId) ? w : wo).push(next.value);
  return welch(w, wo, 'nextDay');
}
