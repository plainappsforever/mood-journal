import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, Chip, Label, Row, Screen, SectionTitle, Segmented, Small, Wrap } from '@/components/ui';
import { addGoal, deleteGoal, setGoalArchived, updateGoal, type Goal } from '@/db/goals';
import { useSQLiteContext } from '@/db/provider';
import type { GoalPeriod } from '@/engine/dates';
import { useActivities, useFormatter, useSettings, type ActivityBook } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { now, today as journalToday } from '@/lib/clock';
import { showError } from '@/lib/errors';
import { goalLine } from '@/lib/goal-text';
import { loadGoalViews, type GoalView } from '@/lib/goal-progress';
import { formatDayShort } from '@/lib/locale';
import { write } from '@/lib/write';

export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const settings = useSettings();
  const activities = useActivities();
  const today = journalToday(settings.dayEndHour);
  const views = useLoad(() => loadGoalViews(db, today, settings.weekStart, { includeArchived: true }), [today, settings.weekStart]);
  const isNew = id === 'new';
  const view = isNew ? null : (views?.find((v) => v.goal.id === Number(id)) ?? null);
  if (!activities || !views || (!isNew && !view)) return <Screen>{null}</Screen>;
  return <GoalEditor key={view?.goal.id ?? 'new'} view={view} activities={activities} today={today} />;
}

function GoalEditor({ view, activities, today }: { view: GoalView | null; activities: ActivityBook; today: string }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { t, locale } = useFormatter();
  const goal: Goal | null = view?.goal ?? null;
  const [activityId, setActivityId] = useState<number | null>(goal?.activityId ?? null);
  const [period, setPeriod] = useState<GoalPeriod>(goal?.period ?? 'week');
  const [target, setTarget] = useState(goal?.target ?? 3);
  const max = period === 'week' ? 7 : period === 'month' ? 31 : 1;
  const effective = period === 'day' ? 1 : Math.min(target, max);

  const save = async () => {
    if (activityId === null) return;
    const input = { activityId, period, target: effective, startDate: goal?.startDate ?? today };
    try {
      if (goal) await write(() => updateGoal(db, goal.id, input));
      else await write(() => addGoal(db, input, now()));
      router.back();
    } catch (e) {
      showError(t, e);
    }
  };

  const recent = view ? [...view.result.instances].reverse().slice(0, 12) : [];
  return (
    <Screen testID="goal-editor">
      <Stack.Screen options={{ title: goal ? t('goals.edit') : t('goals.add') }} />
      {view ? (
        <Card testID="goal-summary">
          <Label testID={`goal-progress-${view.goal.id}`}>{goalLine(t, view, activities.byId.get(view.goal.activityId))}</Label>
          <Small>{t('goals.streak', { n: view.result.streak })}</Small>
          {view.result.successRate !== null ? <Small>{t('goals.rate', { pct: Math.round(view.result.successRate * 100) })}</Small> : null}
        </Card>
      ) : null}
      <SectionTitle>{t('goals.activity')}</SectionTitle>
      <View testID="goal-activity">
        <Wrap>
          {activities.all
            .filter((a) => !a.archived || a.id === activityId)
            .map((a) => (
              <Chip key={a.id} testID={`goal-activity-${a.id}`} label={`${a.emoji} ${a.name}`} selected={a.id === activityId} onPress={() => setActivityId(a.id)} />
            ))}
        </Wrap>
      </View>
      <SectionTitle>{t('goals.period')}</SectionTitle>
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'day', label: t('goals.period.day'), testID: 'goal-period-day' },
          { value: 'week', label: t('goals.period.week'), testID: 'goal-period-week' },
          { value: 'month', label: t('goals.period.month'), testID: 'goal-period-month' },
        ]}
      />
      {period !== 'day' ? (
        <View style={styles.target}>
          <Chip testID="goal-target-minus" label="−" onPress={() => setTarget(Math.max(1, effective - 1))} />
          <Text testID="goal-target" style={[styles.targetText, { color: theme.text }]}>
            {t(period === 'week' ? 'goals.target.week' : 'goals.target.month', { n: effective })}
          </Text>
          <Chip testID="goal-target-plus" label="+" onPress={() => setTarget(Math.min(max, effective + 1))} />
        </View>
      ) : null}
      <Button testID="goal-save" label={t('common.save')} disabled={activityId === null} onPress={() => void save()} />
      {view && goal ? (
        <>
          <SectionTitle>{t('goals.history')}</SectionTitle>
          <Card testID="goal-history">
            {recent.length === 0 ? <Small>{t('goals.noHistory')}</Small> : null}
            {recent.map((i) => (
              <Row
                key={i.start}
                label={i.start === i.end ? formatDayShort(locale, i.start) : `${formatDayShort(locale, i.start)} – ${formatDayShort(locale, i.end)}`}
                value={`${i.count}/${view.result.target} ${i.success ? '✓' : i.complete ? '–' : '…'}`}
              />
            ))}
          </Card>
          <Button testID="goal-archive" variant="secondary" label={goal.archived ? t('common.unarchive') : t('common.archive')} onPress={() => void write(() => setGoalArchived(db, goal.id, !goal.archived)).then(() => router.back(), (e) => showError(t, e))} />
          <Button
            testID="goal-delete"
            variant="secondary"
            label={t('goals.delete')}
            onPress={() =>
              Alert.alert(t('goals.deleteTitle'), t('goals.deleteText'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.delete'), style: 'destructive', onPress: () => void write(() => deleteGoal(db, goal.id)).then(() => router.back(), (e) => showError(t, e)) },
              ])
            }
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  target: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  targetText: { fontSize: 16, flex: 1, textAlign: 'center' },
});
