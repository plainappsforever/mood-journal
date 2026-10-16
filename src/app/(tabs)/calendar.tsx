import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, Screen, Segmented, Small } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { addDays } from '@/engine/dates';
import { dayIndex, monthGrid, pixelLevels, yearPixels } from '@/engine/stats';
import { useFormatter, useMoods, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { calendarToday } from '@/lib/clock';
import { levelColor } from '@/lib/levels';
import { formatMonthShort, formatMonthYear, weekdayName } from '@/lib/locale';
import { statEntries } from '@/lib/stat-cache';

// Calendar (SPEC Screens): month grid coloured by the day's level (Formula 7) and Year in Pixels; a day opens its sheet.
export default function Calendar() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { t, locale } = useFormatter();
  const settings = useSettings();
  const moods = useMoods();
  const all = useLoad(() => statEntries(db), []);
  const today = calendarToday();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  const [year, setYear] = useState(Number(today.slice(0, 4)));

  const levels = useMemo(() => {
    if (!all) return new Map<string, number>();
    const prefix = `${month.y}-${String(month.m).padStart(2, '0')}`;
    return pixelLevels(dayIndex(all.filter((e) => e.date.startsWith(prefix))));
  }, [all, month]);
  const pixels = useMemo(() => (all && mode === 'year' ? yearPixels(all, year) : null), [all, year, mode]);

  if (!moods) return <Screen testID="calendar-screen">{null}</Screen>;
  const shift = (n: number) => setMonth(({ y, m }) => ({ y: y + Math.floor((m - 1 + n) / 12), m: ((((m - 1 + n) % 12) + 12) % 12) + 1 }));
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => ((settings.weekStart - 1 + i) % 7) + 1);

  return (
    <Screen testID="calendar-screen">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'month', label: t('calendar.month'), testID: 'cal-mode-month' },
          { value: 'year', label: t('calendar.year'), testID: 'cal-mode-year' },
        ]}
      />
      {mode === 'month' ? (
        <View style={styles.block}>
          <View style={styles.nav}>
            <Chip testID="cal-prev" label="‹" accessibilityLabel={t('calendar.prev')} onPress={() => shift(-1)} />
            <Text testID="cal-title" style={[styles.title, { color: theme.text }]}>
              {formatMonthYear(locale, month.y, month.m)}
            </Text>
            <Chip testID="cal-next" label="›" accessibilityLabel={t('calendar.next')} onPress={() => shift(1)} />
          </View>
          <View style={styles.week}>
            {weekdays.map((w) => (
              <Text key={w} style={[styles.weekday, { color: theme.textSecondary }]}>
                {weekdayName(locale, w, 'narrow')}
              </Text>
            ))}
          </View>
          {monthGrid(month.y, month.m, settings.weekStart).map((row, r) => (
            <View key={r} style={styles.week}>
              {row.map((date, c) => {
                if (!date) return <View key={c} style={styles.cell} />;
                const level = levels.get(date);
                const future = date > addDays(today, 1);
                return (
                  <Pressable
                    key={date}
                    testID={`cal-day-${date}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${date}${level ? `, ${t('calendar.level', { n: level })}` : ''}`}
                    disabled={future}
                    onPress={() => router.push(`/day/${date}` as Href)}
                    style={[
                      styles.cell,
                      styles.day,
                      { backgroundColor: level ? levelColor(moods, level) : theme.empty, opacity: future ? 0.35 : 1 },
                      date === today && { borderWidth: 2, borderColor: theme.text },
                    ]}>
                    <Text style={[styles.dayText, { color: level ? '#ffffff' : theme.text }]}>{Number(date.slice(8))}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Small>{t('calendar.hint')}</Small>
        </View>
      ) : (
        <View style={styles.block}>
          <View style={styles.nav}>
            <Chip testID="pixels-prev" label="‹" accessibilityLabel={t('calendar.prev')} onPress={() => setYear(year - 1)} />
            <Text testID="pixels-title" style={[styles.title, { color: theme.text }]}>
              {year}
            </Text>
            <Chip testID="pixels-next" label="›" accessibilityLabel={t('calendar.next')} onPress={() => setYear(year + 1)} />
          </View>
          {pixels ? (
            <View testID="pixels-grid" style={styles.pixels}>
              <View style={styles.pixelCol}>
                <Text style={[styles.pixelHead, { color: theme.textSecondary }]}> </Text>
                {Array.from({ length: 31 }, (_, d) => (
                  <Text key={d} style={[styles.pixelDay, { color: theme.textSecondary }]}>
                    {d % 5 === 0 ? d + 1 : ''}
                  </Text>
                ))}
              </View>
              {pixels.months.map((cells, m) => (
                <View key={m} style={[styles.pixelCol, styles.flex]}>
                  <Text style={[styles.pixelHead, { color: theme.textSecondary }]}>{formatMonthShort(locale, m + 1).slice(0, 1)}</Text>
                  {cells.map((c) => (
                    <Pressable
                      key={c.date}
                      testID={`pixel-${c.date}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${c.date}${c.level ? `, ${t('calendar.level', { n: c.level })}` : ''}`}
                      disabled={c.date > addDays(today, 1)}
                      onPress={() => router.push(`/day/${c.date}` as Href)}
                      style={[styles.pixel, { backgroundColor: c.level ? levelColor(moods, c.level) : theme.empty }]}
                    />
                  ))}
                </View>
              ))}
            </View>
          ) : null}
          <Small testID="pixels-logged">{t('calendar.logged', { n: pixels?.logged ?? 0 })}</Small>
          <View testID="pixels-legend" style={styles.legend}>
            {[5, 4, 3, 2, 1].map((l) => (
              <View key={l} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: levelColor(moods, l) }]} />
                <Small>{moods.firstOfLevel.get(l)?.name ?? l}</Small>
              </View>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { gap: Spacing.two },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  week: { flexDirection: 'row', gap: 4 },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12 },
  cell: { flex: 1, aspectRatio: 1 },
  day: { borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 14, fontWeight: '600' },
  pixels: { flexDirection: 'row', gap: 2 },
  pixelCol: { gap: 2, alignItems: 'stretch' },
  pixelHead: { fontSize: 10, textAlign: 'center', height: 14 },
  pixelDay: { fontSize: 8, height: 10, width: 14, textAlign: 'right' },
  pixel: { height: 10, borderRadius: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
});
