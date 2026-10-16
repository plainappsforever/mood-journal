import { router, useNavigation, type Href } from 'expo-router';
import { useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EntryRow } from '@/components/entry-row';
import { MoodFace } from '@/components/mood-face';
import { Chip, Small } from '@/components/ui';
import { listEntries, loggedDates, type Entry } from '@/db/entries';
import { useSQLiteContext } from '@/db/provider';
import { computeStreak } from '@/engine/streaks';
import { formatStreak } from '@/engine/stats';
import { Spacing } from '@/constants/theme';
import { useActivities, useFormatter, useMoods, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { calendarToday, today as journalToday } from '@/lib/clock';
import { loadGoalViews } from '@/lib/goal-progress';
import { goalLine } from '@/lib/goal-text';
import { formatDayRelative } from '@/lib/locale';
import { ReminderCard } from '@/components/reminder-card';

const PAGE = 60;

type Item = { kind: 'day'; date: string } | { kind: 'entry'; entry: Entry };

// Home: "How are you?" with five faces (two taps to an entry, A1), streak, goals strip, timeline by day.
export default function Entries() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const f = useFormatter();
  const { t, locale } = f;
  const settings = useSettings();
  const moods = useMoods();
  const activities = useActivities();
  const navigation = useNavigation();
  const [limit, setLimit] = useState(PAGE);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const today = journalToday(settings.dayEndHour);

  const entries = useLoad(() => listEntries(db, { limit }), [limit]);
  const streak = useLoad(async () => computeStreak(await loggedDates(db), today), [today]);
  const goals = useLoad(() => loadGoalViews(db, today, settings.weekStart), [today, settings.weekStart]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable testID="open-search" accessibilityRole="button" accessibilityLabel={t('search.title')} hitSlop={12} onPress={() => router.push('/search' as Href)} style={styles.headerBtn}>
          <Text style={{ fontSize: 20, color: theme.tint }}>⌕</Text>
        </Pressable>
      ),
    });
  }, [navigation, t, theme.tint]);

  const items = useMemo(() => {
    const out: Item[] = [];
    let last = '';
    for (const e of entries ?? []) {
      if (e.localDate !== last) out.push({ kind: 'day', date: e.localDate });
      last = e.localDate;
      out.push({ kind: 'entry', entry: e });
    }
    return out;
  }, [entries]);

  if (!moods || !activities || !entries) return <View testID="home-loading" style={[styles.flex, { backgroundColor: theme.background }]} />;

  const levelMoods = openLevel ? moods.active.filter((m) => m.level === openLevel) : [];
  const activeGoals = (goals ?? []).filter((g) => !g.goal.archived);

  const header = (
    <View style={styles.header}>
      <Text style={[styles.question, { color: theme.text }]}>{t('home.question')}</Text>
      <View style={styles.faces}>
        {[5, 4, 3, 2, 1].map((level) => {
          const mood = moods.firstOfLevel.get(level);
          if (!mood) return null;
          return (
            <MoodFace
              key={level}
              mood={mood}
              label
              testID={`mood-level-${level}`}
              onPress={() => router.push(`/entry/new?mood=${mood.id}` as Href)}
              onLongPress={() => setOpenLevel(openLevel === level ? null : level)}
            />
          );
        })}
      </View>
      {levelMoods.length > 1 ? (
        <View style={styles.levelMoods} testID="level-moods">
          {levelMoods.map((m) => (
            <Chip key={m.id} testID={`level-mood-${m.id}`} label={`${m.emoji} ${m.name}`} onPress={() => router.push(`/entry/new?mood=${m.id}` as Href)} />
          ))}
        </View>
      ) : null}
      <Small testID="streak-text">{streak ? formatStreak(f, streak.current, streak.longest) : ' '}</Small>
      {activeGoals.length ? (
        <Pressable testID="home-goals" accessibilityRole="button" accessibilityLabel={t('goals.title')} onPress={() => router.push('/goals' as Href)} style={[styles.goals, { backgroundColor: theme.backgroundElement }]}>
          {activeGoals.slice(0, 4).map((v) => (
            <Text key={v.goal.id} testID={`home-goal-${v.goal.id}`} style={{ color: theme.text, fontSize: 14 }}>
              {goalLine(t, v, activities.byId.get(v.goal.activityId))}
            </Text>
          ))}
        </Pressable>
      ) : null}
      <ReminderCard hasEntries={entries.length > 0} />
      {entries.length === 0 ? (
        <View testID="home-empty" style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{t('home.empty')}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      testID="timeline"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(item) => (item.kind === 'day' ? `d${item.date}` : `e${item.entry.id}`)}
      ListHeaderComponent={<View testID="home-screen">{header}</View>}
      renderItem={({ item }) =>
        item.kind === 'day' ? (
          <Text style={[styles.day, { color: theme.textSecondary }]}>{formatDayRelative(t, locale, item.date, calendarToday())}</Text>
        ) : (
          <EntryRow entry={item.entry} moods={moods} activities={activities} locale={locale} onPress={() => router.push(`/entry/${item.entry.id}` as Href)} />
        )
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (entries.length >= limit) setLimit(limit + PAGE);
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  header: { gap: Spacing.three, marginBottom: Spacing.two },
  question: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: Spacing.two },
  faces: { flexDirection: 'row', justifyContent: 'space-between' },
  levelMoods: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  goals: { borderRadius: 12, padding: Spacing.three, gap: 4 },
  empty: { paddingVertical: Spacing.five, alignItems: 'center' },
  emptyText: { fontSize: 16, textAlign: 'center' },
  day: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginTop: Spacing.two },
  headerBtn: { paddingHorizontal: 12 },
});
