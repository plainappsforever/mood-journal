import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { LevelBars, MoodLineChart } from '@/components/charts';
import { MoodFace } from '@/components/mood-face';
import { Card, Chip, Label, Row, Screen, SectionTitle, Segmented, Small } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { addDays, dayNumber, diffDays, fromDayNumber, type DateStr } from '@/engine/dates';
import { computeStreak } from '@/engine/streaks';
import { formatAverage, formatFrequency, formatStreak, overview, type Overview } from '@/engine/stats';
import { useActivities, useFormatter, useMoods, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { today as journalToday } from '@/lib/clock';
import { levelColor } from '@/lib/levels';
import { formatDayShort, formatMonthShort, weekdayName } from '@/lib/locale';
import { makePeriod, periodParams, type PeriodChoice } from '@/lib/periods';
import { statEntries } from '@/lib/stat-cache';

function seriesX(mode: 'day' | 'week' | 'month', key: string, start: DateStr): number {
  if (mode === 'day') return diffDays(start, key);
  if (mode === 'week') return Math.round(diffDays(start, key) / 7);
  const [y, m] = key.split('-').map(Number);
  return (y - Number(start.slice(0, 4))) * 12 + (m - Number(start.slice(5, 7)));
}

// Stats (SPEC Screens, Formulas 1–12): period chips, average, chart, counts, weekday, months, streak, together, activities.
export default function Stats() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const f = useFormatter();
  const { t, locale } = f;
  const settings = useSettings();
  const moods = useMoods();
  const activities = useActivities();
  const all = useLoad(() => statEntries(db), []);
  const [choice, setChoice] = useState<PeriodChoice>('30d');
  const today = journalToday(settings.dayEndHour);
  const [custom, setCustom] = useState({ start: addDays(today, -6), end: today });
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const firstDate = useMemo(() => (all && all.length ? all.reduce((m, e) => (e.date < m ? e.date : m), all[0].date) : null), [all]);
  const period = makePeriod(choice, today, firstDate, custom);
  const view: { o: Overview; ms: number } | null = useMemo(() => {
    if (!all || !activities) return null;
    const started = Date.now();
    const o = overview(all, period, settings.weekStart, activities.all.map((a) => a.id));
    return { o, ms: Date.now() - started };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, activities, period.start, period.end, period.kind, settings.weekStart]);
  const streak = useMemo(() => (all ? computeStreak(new Set(all.map((e) => e.date)), today) : null), [all, today]);

  if (!moods || !activities || !view || !streak) return <Screen testID="stats-loading">{null}</Screen>;
  const { o } = view;
  const avg = formatAverage(f, o.average);
  const color = (v: number) => levelColor(moods, v);
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => ((settings.weekStart - 1 + i) % 7) + 1);
  const points = o.series.points.map((p) => ({ x: seriesX(o.series.mode, p.key, o.series.mode === 'week' ? o.series.points[0].key : period.start), value: p.value }));
  const xMax = Math.max(1, o.series.mode === 'day' ? diffDays(period.start, period.end) : points.length ? Math.max(...points.map((p) => p.x)) : 1);
  const monthly = [...o.monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  const used = activities.all
    .map((a) => ({ a, n: o.frequency.get(a.id)?.current ?? 0, d: o.frequency.get(a.id)?.difference ?? 0 }))
    .filter((x) => x.n > 0 || !x.a.archived)
    .sort((x, y) => y.n - x.n || x.a.name.localeCompare(y.a.name));
  const openPick = (which: 'start' | 'end') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: new Date(dayNumber(custom[which]) * 86_400_000 + 43_200_000),
        mode: 'date',
        timeZoneName: 'UTC',
        onChange: (e, d) => e.type === 'set' && d && setCustom({ ...custom, [which]: fromDayNumber(Math.floor(d.getTime() / 86_400_000)) }),
      });
    } else setPicking(picking === which ? null : which);
  };

  return (
    <Screen testID="stats-screen">
      <Segmented
        value={choice}
        onChange={setChoice}
        options={[
          { value: '30d', label: t('stats.period.30d'), testID: 'period-30d' },
          { value: 'month', label: t('stats.period.month'), testID: 'period-month' },
          { value: 'year', label: t('stats.period.year'), testID: 'period-year' },
          { value: 'all', label: t('stats.period.all'), testID: 'period-all' },
          { value: 'custom', label: t('stats.period.custom'), testID: 'period-custom' },
        ]}
      />
      {choice === 'custom' ? (
        <View style={styles.row}>
          <Chip testID="custom-start" label={formatDayShort(locale, custom.start)} onPress={() => openPick('start')} />
          <Text style={{ color: theme.textSecondary }}>–</Text>
          <Chip testID="custom-end" label={formatDayShort(locale, custom.end)} onPress={() => openPick('end')} />
        </View>
      ) : null}
      {picking && Platform.OS === 'ios' ? (
        <DateTimePicker
          value={new Date(dayNumber(custom[picking]) * 86_400_000 + 43_200_000)}
          mode="date"
          display="inline"
          timeZoneName="UTC"
          onChange={(_e, d) => d && setCustom({ ...custom, [picking]: fromDayNumber(Math.floor(d.getTime() / 86_400_000)) })}
        />
      ) : null}
      <Small testID="stats-range">{`${formatDayShort(locale, period.start)} – ${formatDayShort(locale, period.end)}`}</Small>

      <Card testID="stat-average">
        <SectionTitle>{t('stats.card.average')}</SectionTitle>
        <Text testID="stat-average-value" style={[styles.big, { color: theme.text }]}>
          {avg.value}
        </Text>
        <Small testID="stat-average-basis">{avg.basis}</Small>
      </Card>

      <Card testID="stat-chart">
        <SectionTitle>{t(`stats.card.chart.${o.series.mode}`)}</SectionTitle>
        {points.length ? (
          <MoodLineChart points={points} xMax={xMax} breakGaps={o.series.mode === 'day'} color={theme.tint} summary={`${t('stats.card.average')} ${avg.value}, ${avg.basis}`} />
        ) : (
          <Small>{t('stats.average.none')}</Small>
        )}
      </Card>

      <Card testID="stat-counts">
        <SectionTitle>{t('stats.card.counts')}</SectionTitle>
        {[5, 4, 3, 2, 1].map((level) => {
          const n = o.counts.byLevel[level as 1 | 2 | 3 | 4 | 5];
          const mood = moods.firstOfLevel.get(level);
          return (
            <Row
              key={level}
              testID={`stat-level-${level}`}
              left={mood ? <MoodFace mood={mood} size={28} /> : undefined}
              label={mood?.name ?? String(level)}
              value={String(n)}
              onPress={() => router.push(`/stats/level/${level}?${periodParams(period)}` as Href)}
              accessibilityLabel={`${mood?.name ?? level}: ${n}`}
            />
          );
        })}
      </Card>

      <Card testID="stat-weekday">
        <SectionTitle>{t('stats.card.weekday')}</SectionTitle>
        <LevelBars
          values={weekdays.map((w) => o.weekday[w - 1].mean)}
          labels={weekdays.map((w) => weekdayName(locale, w, 'narrow'))}
          colorFor={color}
          summary={weekdays.map((w) => `${weekdayName(locale, w, 'short')} ${o.weekday[w - 1].mean?.toFixed(1) ?? '–'}`).join(', ')}
        />
      </Card>

      {monthly.length > 1 ? (
        <Card testID="stat-monthly">
          <SectionTitle>{t('stats.card.monthly')}</SectionTitle>
          <LevelBars
            values={monthly.map(([, m]) => m.mean)}
            labels={monthly.map(([k]) => formatMonthShort(locale, Number(k.slice(5))).slice(0, 3))}
            colorFor={color}
            summary={monthly.map(([k, m]) => `${k} ${m.mean?.toFixed(1)}`).join(', ')}
          />
        </Card>
      ) : null}

      <Card testID="stat-streak">
        <SectionTitle>{t('stats.card.streak')}</SectionTitle>
        <Label>{formatStreak(f, streak.current, streak.longest)}</Label>
      </Card>

      <Card testID="stat-together">
        <SectionTitle>{t('stats.card.together')}</SectionTitle>
        {o.topPairs.length === 0 ? <Small>{t('stats.together.none')}</Small> : null}
        {o.topPairs.map((p) => {
          const a = activities.byId.get(p.a);
          const b = activities.byId.get(p.b);
          return <Label key={`${p.a}-${p.b}`}>{`${a?.emoji ?? ''} ${a?.name ?? '?'} + ${b?.emoji ?? ''} ${b?.name ?? '?'} · ${p.count}`}</Label>;
        })}
      </Card>

      <SectionTitle>{t('stats.card.activities')}</SectionTitle>
      <Card>
        {used.map(({ a, n, d }) => (
          <Row
            key={a.id}
            testID={`stat-activity-${a.id}`}
            label={`${a.emoji} ${a.name}${a.archived ? ` (${t('common.archived')})` : ''}`}
            value={`${n} · ${formatFrequency(f, d)}`}
            onPress={() => router.push(`/stats/activity/${a.id}?${periodParams(period)}` as Href)}
          />
        ))}
      </Card>
      {__DEV__ ? <Small testID="stats-timing">{`${view.ms} ms · ${all?.length ?? 0}`}</Small> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  big: { fontSize: 40, fontWeight: '700' },
});
