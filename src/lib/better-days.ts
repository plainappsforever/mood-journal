// "Your better days often have: {activity}" on Home. Plain counting over days, no claim about causes (SPEC Honest promises).
import { dayIndex, pixelLevels } from '@/engine/stats';
import type { StatEntry } from '@/engine/stats';

export const MIN_LOGGED_DAYS = 7;
export const MIN_GOOD_DAYS = 3;

/**
 * The activity that shows up on good days (day level 4 or 5) clearly more often than on all days: at least 3 good days
 * with it, and the share of good days among the days with it above the share of good days overall. Null while there is
 * too little data.
 */
export function betterDaysActivity(entries: readonly StatEntry[]): number | null {
  const days = dayIndex(entries);
  const levels = pixelLevels(days);
  if (days.size < MIN_LOGGED_DAYS) return null;
  const good = new Set([...levels].filter(([, l]) => l >= 4).map(([d]) => d));
  if (good.size < MIN_GOOD_DAYS) return null;
  const overall = good.size / days.size;
  const withAct = new Map<number, number>();
  const goodWithAct = new Map<number, number>();
  for (const [date, info] of days) {
    for (const a of info.activities) {
      withAct.set(a, (withAct.get(a) ?? 0) + 1);
      if (good.has(date)) goodWithAct.set(a, (goodWithAct.get(a) ?? 0) + 1);
    }
  }
  let best: { id: number; share: number; count: number } | null = null;
  for (const [id, count] of goodWithAct) {
    if (count < MIN_GOOD_DAYS) continue;
    const share = count / (withAct.get(id) ?? count);
    if (share <= overall) continue;
    if (!best || share > best.share || (share === best.share && (count > best.count || (count === best.count && id < best.id)))) best = { id, share, count };
  }
  return best ? best.id : null;
}
