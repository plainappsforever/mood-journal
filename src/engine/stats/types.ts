import type { DateStr, PeriodKind } from '../dates';

/** One entry as the statistics engine sees it: its mood's CURRENT level, its journal day and its activities. */
export type StatEntry = { id: number; moodId: number; level: number; date: DateStr; activityIds: readonly number[] };
/** Inclusive date range; `kind` = how the Stats chip chose it (only Formula 11's comparison period depends on it). */
export type Period = { start: DateStr; end: DateStr; kind?: PeriodKind };
/** A mean with the number of values it is based on (null mean when n = 0). */
export type Mean = { mean: number | null; n: number };

/** Tolerance for float noise: day values are small rationals, so a true tie or zero is never closer than this. */
export const EPS = 1e-9;

export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Sample variance (n − 1); 0 for fewer than 2 values. Two-pass for accuracy. */
export function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = meanOf(values) as number;
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return s / (values.length - 1);
}

/** round(x) = floor(x + 0.5) with float-noise tolerance (3.5 → 4; SPEC Formula 7). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + EPS);
}

/** One decimal, round half up (SPEC Formula 2): 3.85 → 3.9. */
export function roundOneDecimal(x: number): number {
  return Math.floor(x * 10 + 0.5 + EPS) / 10;
}
