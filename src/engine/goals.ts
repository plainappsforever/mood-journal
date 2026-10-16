// Formula 13 (SPEC): goal on activity a with period day/week/month, target k (day goals: k = 1) and start date s.
// Instances run from the one containing s to the one containing today (weeks by `week_start`, calendar months).
// c(p) = distinct days inside p with ≥ 1 entry containing a (all of p's days count, also those before s — D33).
// Success ⇔ c(p) ≥ k. Complete ⇔ the instance ended before today. Goal streak = consecutive successful complete
// instances ending at the last complete one, plus the current one if it already succeeded. Success rate =
// successful complete / complete (null without complete instances). Archived activity → paused, nothing counted.
import { addDays, instanceOf, type DateStr, type GoalPeriod, type WeekStart } from './dates';

export type GoalInput = { period: GoalPeriod; target: number; startDate: DateStr; activityArchived: boolean };
export type GoalInstance = { start: DateStr; end: DateStr; count: number; success: boolean; complete: boolean };
export type GoalResult = {
  paused: boolean;
  /** Effective target (1 for day goals). */
  target: number;
  instances: GoalInstance[];
  /** The instance containing today (null when paused or the goal starts after today). */
  current: GoalInstance | null;
  streak: number;
  successRate: number | null;
};

/**
 * `daysWithActivity` = journal days that have ≥ 1 entry containing the goal's activity (any order, duplicates fine).
 */
export function computeGoal(goal: GoalInput, daysWithActivity: Iterable<DateStr>, today: DateStr, weekStart: WeekStart): GoalResult {
  const target = goal.period === 'day' ? 1 : Math.max(1, Math.floor(goal.target));
  if (goal.activityArchived) return { paused: true, target, instances: [], current: null, streak: 0, successRate: null };
  const days = new Set(daysWithActivity);
  const instances: GoalInstance[] = [];
  if (goal.startDate <= today) {
    const last = instanceOf(today, goal.period, weekStart).start;
    let { start, end } = instanceOf(goal.startDate, goal.period, weekStart);
    while (start <= last) {
      let count = 0;
      for (let d = start; d <= end; d = addDays(d, 1)) if (days.has(d)) count++;
      instances.push({ start, end, count, success: count >= target, complete: end < today });
      ({ start, end } = instanceOf(addDays(end, 1), goal.period, weekStart));
    }
  }
  const complete = instances.filter((i) => i.complete);
  let streak = 0;
  for (let i = complete.length - 1; i >= 0 && complete[i].success; i--) streak++;
  const lastInstance = instances.at(-1) ?? null;
  const current = lastInstance && !lastInstance.complete ? lastInstance : null;
  if (current?.success) streak++;
  const successRate = complete.length ? complete.filter((i) => i.success).length / complete.length : null;
  return { paused: false, target, instances, current, streak, successRate };
}
