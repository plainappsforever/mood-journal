import Constants from 'expo-constants';
import { router, useFocusEffect, useNavigation, type Href } from 'expo-router';
import * as StoreReview from 'expo-store-review';
import { SymbolView } from 'expo-symbols';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { EntryRow } from '@/components/entry-row';
import { MonthDots } from '@/components/month-dots';
import { MoodFace } from '@/components/mood-face';
import { Chip } from '@/components/ui';
import { listEntries, loggedDates, type Entry } from '@/db/entries';
import { useSQLiteContext } from '@/db/provider';
import { computeStreak } from '@/engine/streaks';
import { dayIndex, formatStreak, pixelLevels } from '@/engine/stats';
import { BrandFonts, Radius, Spacing } from '@/constants/theme';
import { useActivities, useFormatter, useMoods, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { calendarToday, today as journalToday } from '@/lib/clock';
import { loadGoalViews } from '@/lib/goal-progress';
import { goalLine } from '@/lib/goal-text';
import { betterDaysActivity } from '@/lib/better-days';
import { levelColor } from '@/lib/levels';
import { formatDayRelative, formatMonthLong } from '@/lib/locale';
import { statEntries } from '@/lib/stat-cache';
import { maybeAskForReview } from '@/lib/store-review';
import { ReminderCard } from '@/components/reminder-card';

const PAGE = 60;
// Room under the list for the pinned mood panel (question + faces with labels).
const PANEL_ROOM = 170;

type Item = { kind: 'day'; date: string } | { kind: 'entry'; entry: Entry };

// Home (identity sheet 13, Grid): the month as day dots, streak, goals strip, timeline by day; "How are you?" with five faces
// sits in a panel above the tab bar, in thumb reach (two taps to an entry, A1).
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
  const all = useLoad(() => statEntries(db), []);
  const goals = useLoad(() => loadGoalViews(db, today, settings.weekStart), [today, settings.weekStart]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable testID="open-search" accessibilityRole="button" accessibilityLabel={t('search.title')} hitSlop={12} onPress={() => router.push('/search' as Href)} style={styles.headerBtn}>
          {Platform.OS === 'ios' ? (
            <SymbolView name="magnifyingglass" size={20} tintColor={theme.tintText} />
          ) : (
            <Text style={{ fontSize: 20, color: theme.tintText }}>⌕</Text>
          )}
        </Pressable>
      ),
    });
  }, [navigation, t, theme.tintText]);

  // Rating prompt: only here, after the tenth own entry, once per version; never inside the editor (D-redesign R1).
  useFocusEffect(
    useCallback(() => {
      const version = Constants.expoConfig?.version ?? '1.0.0';
      void maybeAskForReview(db, version, async () => {
        if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview();
      });
    }, [db])
  );

  const calToday = calendarToday();
  const year = Number(calToday.slice(0, 4));
  const month = Number(calToday.slice(5, 7));
  const levels = useMemo(() => {
    if (!all) return new Map<string, number>();
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return pixelLevels(dayIndex(all.filter((e) => e.date.startsWith(prefix))));
  }, [all, year, month]);
  const better = useMemo(() => (all ? betterDaysActivity(all) : null), [all]);

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
  const betterActivity = better !== null ? activities.byId.get(better) : undefined;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[styles.month, { color: theme.text }]}>
          {formatMonthLong(locale, month)}
        </Text>
        <Text testID="streak-text" numberOfLines={2} style={[styles.streak, { color: theme.textSecondary }]}>
          {streak ? formatStreak(f, streak.current, streak.longest) : ' '}
        </Text>
      </View>
      <MonthDots
        year={year}
        month={month}
        weekStart={settings.weekStart}
        locale={locale}
        today={calToday}
        colorOf={(date) => {
          const level = levels.get(date);
          return level ? levelColor(moods, level) : null;
        }}
        onPressDay={(date, isToday) => router.push((isToday ? '/entry/new' : `/day/${date}`) as Href)}
        testIDPrefix="home-day-"
        labelOf={(date) => (date === calToday ? t('home.addToday') : date)}
      />
      {betterActivity ? (
        <Text testID="better-days" style={[styles.better, { color: theme.textSecondary }]}>
          {t('home.betterDays', { activity: `${betterActivity.emoji} ${betterActivity.name}` })}
        </Text>
      ) : null}
      {activeGoals.length ? (
        <Pressable testID="home-goals" accessibilityRole="button" accessibilityLabel={t('goals.title')} onPress={() => router.push('/goals' as Href)}>
          <Card style={styles.goals}>
            {activeGoals.slice(0, 4).map((v) => (
              <Text key={v.goal.id} testID={`home-goal-${v.goal.id}`} style={{ color: theme.text, fontSize: 14, fontFamily: BrandFonts.body }}>
                {goalLine(t, v, activities.byId.get(v.goal.activityId))}
              </Text>
            ))}
          </Card>
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
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <FlatList
        testID="timeline"
        style={styles.flex}
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
      <View testID="mood-panel" style={[styles.panel, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Text style={[styles.question, { color: theme.text }]}>{t('home.question')}</Text>
        {levelMoods.length > 1 ? (
          <View style={styles.levelMoods} testID="level-moods">
            {levelMoods.map((m) => (
              <Chip key={m.id} testID={`level-mood-${m.id}`} label={`${m.emoji} ${m.name}`} onPress={() => router.push(`/entry/new?mood=${m.id}` as Href)} />
            ))}
          </View>
        ) : null}
        <View style={styles.faces}>
          {[5, 4, 3, 2, 1].map((level) => {
            const mood = moods.firstOfLevel.get(level);
            if (!mood) return null;
            return (
              <MoodFace
                key={level}
                mood={mood}
                label
                size={48}
                testID={`mood-level-${level}`}
                onPress={() => router.push(`/entry/new?mood=${mood.id}` as Href)}
                onLongPress={() => setOpenLevel(openLevel === level ? null : level)}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, paddingBottom: PANEL_ROOM },
  header: { gap: Spacing.three, marginBottom: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  month: { fontSize: 28, fontWeight: '700', fontFamily: BrandFonts.title },
  streak: { flexShrink: 1, fontSize: 13, textAlign: 'right', fontFamily: BrandFonts.body },
  better: { fontSize: 15, fontFamily: BrandFonts.body },
  levelMoods: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  goals: { padding: Spacing.three, gap: 4 },
  empty: { paddingVertical: Spacing.three, alignItems: 'center' },
  emptyText: { fontSize: 16, textAlign: 'center', fontFamily: BrandFonts.body },
  day: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginTop: Spacing.two, fontFamily: BrandFonts.body },
  headerBtn: { paddingHorizontal: 12 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  question: { fontSize: 15, fontWeight: '700', textAlign: 'center', fontFamily: BrandFonts.title },
  faces: { flexDirection: 'row', justifyContent: 'space-between' },
});
