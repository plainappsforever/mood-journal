import type { Activity } from '@/db/activities';
import type { Translator } from '@/lib/i18n';
import type { GoalView } from '@/lib/goal-progress';

/** "🏃 sport: 1 of 3 this week" (or "paused while the activity is archived"). */
export function goalLine(t: Translator, v: GoalView, activity: Activity | undefined): string {
  const name = activity ? `${activity.emoji} ${activity.name}` : '?';
  if (v.result.paused) return t('goal.paused', { activity: name });
  return t(`goal.progress.${v.goal.period}`, { activity: name, count: v.result.current?.count ?? 0, target: v.result.target });
}
