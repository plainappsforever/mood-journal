import { daysWithActivity, listGoals, type Goal } from '@/db/goals';
import type { Db } from '@/db/types';
import type { DateStr, WeekStart } from '@/engine/dates';
import { computeGoal, type GoalResult } from '@/engine/goals';

export type GoalView = { goal: Goal; result: GoalResult };

/** Every goal with its Formula-13 result for `today` (the journal day, D54). */
export async function loadGoalViews(db: Db, today: DateStr, weekStart: WeekStart, opts: { includeArchived?: boolean } = {}): Promise<GoalView[]> {
  const goals = await listGoals(db, opts);
  const out: GoalView[] = [];
  for (const goal of goals) {
    const days = await daysWithActivity(db, goal.activityId);
    out.push({ goal, result: computeGoal(goal, days, today, weekStart) });
  }
  return out;
}
