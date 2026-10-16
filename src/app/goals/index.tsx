import { router, Stack, type Href } from 'expo-router';

import { Button } from '@/components/button';
import { Card, Row, Screen, Small } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { useActivities, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useT } from '@/hooks/use-t';
import { today as journalToday } from '@/lib/clock';
import { goalLine } from '@/lib/goal-text';
import { loadGoalViews } from '@/lib/goal-progress';

// Goals (SPEC Goals, Formula 13): unlimited, on any activity; progress for the current day/week/month.
export default function Goals() {
  const db = useSQLiteContext();
  const t = useT();
  const settings = useSettings();
  const activities = useActivities();
  const today = journalToday(settings.dayEndHour);
  const views = useLoad(() => loadGoalViews(db, today, settings.weekStart, { includeArchived: true }), [today, settings.weekStart]);
  return (
    <Screen testID="goals-screen">
      <Stack.Screen options={{ title: t('goals.title') }} />
      {views && views.length === 0 ? <Small>{t('goals.empty')}</Small> : null}
      <Card>
        {(views ?? []).map((v) => {
          const a = activities?.byId.get(v.goal.activityId);
          return (
            <Row
              key={v.goal.id}
              testID={`goal-${v.goal.id}`}
              label={goalLine(t, v, a)}
              value={v.goal.archived ? t('common.archived') : undefined}
              onPress={() => router.push(`/goals/${v.goal.id}` as Href)}
            />
          );
        })}
      </Card>
      <Button testID="goal-add" label={t('goals.add')} onPress={() => router.push('/goals/new' as Href)} />
    </Screen>
  );
}
