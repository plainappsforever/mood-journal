// Formulas 9–11 — often together, related activities per level, frequency vs the previous period.
import { previousPeriod } from '../dates';

import { entriesIn } from './days';
import type { Period, StatEntry } from './types';

export type TogetherRow = { activityId: number; count: number; share: number };
export type Pair = { a: number; b: number; count: number };

export const TOP_PAIRS = 10;
export const MIN_PAIR_COUNT = 3;
export const TOP_RELATED = 10;

function byCountThenId(x: { count: number; activityId: number }, y: { count: number; activityId: number }) {
  return y.count - x.count || x.activityId - y.activityId;
}

/** Formula 9 for activity a: other activities by entries together (desc, then id), share = together / entries(a). */
export function oftenTogether(entries: readonly StatEntry[], activityId: number): TogetherRow[] {
  let withA = 0;
  const counts = new Map<number, number>();
  for (const e of entries) {
    if (!e.activityIds.includes(activityId)) continue;
    withA++;
    for (const b of new Set(e.activityIds)) if (b !== activityId) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts]
    .map(([b, count]) => ({ activityId: b, count, share: count / withA }))
    .sort(byCountThenId);
}

/** Formula 9, global: the 10 most frequent pairs with together ≥ 3 (count desc, then a, then b; a < b). */
export function topPairs(entries: readonly StatEntry[]): Pair[] {
  const counts = new Map<string, Pair>();
  for (const e of entries) {
    const ids = [...new Set(e.activityIds)].sort((x, y) => x - y);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]},${ids[j]}`;
        const p = counts.get(k);
        if (p) p.count++;
        else counts.set(k, { a: ids[i], b: ids[j], count: 1 });
      }
    }
  }
  return [...counts.values()]
    .filter((p) => p.count >= MIN_PAIR_COUNT)
    .sort((x, y) => y.count - x.count || x.a - y.a || x.b - y.b)
    .slice(0, TOP_PAIRS);
}

/** Formula 10: share(a | L) = entries at level L containing a / entries at level L; top 10 (count desc, then id). */
export function relatedForLevel(entries: readonly StatEntry[], level: number): TogetherRow[] {
  let atLevel = 0;
  const counts = new Map<number, number>();
  for (const e of entries) {
    if (e.level !== level) continue;
    atLevel++;
    for (const a of new Set(e.activityIds)) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts]
    .map(([a, count]) => ({ activityId: a, count, share: count / atLevel }))
    .sort(byCountThenId)
    .slice(0, TOP_RELATED);
}

export type Frequency = { current: number; previous: number; difference: number };

/** Formula 11: entries containing a in P vs the previous period (`previousPeriod`, D53). `all` = every entry. */
export function frequencies(all: readonly StatEntry[], period: Period, activityIds: readonly number[]): Map<number, Frequency> {
  const prev = previousPeriod(period.start, period.end, period.kind);
  const cur = new Map<number, number>();
  const before = new Map<number, number>();
  for (const e of entriesIn(all, period)) for (const a of new Set(e.activityIds)) cur.set(a, (cur.get(a) ?? 0) + 1);
  for (const e of entriesIn(all, prev)) for (const a of new Set(e.activityIds)) before.set(a, (before.get(a) ?? 0) + 1);
  return new Map(
    activityIds.map((a) => {
      const current = cur.get(a) ?? 0;
      const previous = before.get(a) ?? 0;
      return [a, { current, previous, difference: current - previous }];
    })
  );
}
