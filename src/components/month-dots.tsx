import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandFonts, Spacing } from '@/constants/theme';
import { addDays } from '@/engine/dates';
import { monthGrid } from '@/engine/stats';
import type { WeekStart } from '@/engine/dates';
import { useTheme } from '@/hooks/use-theme';
import { readableOn } from '@/lib/levels';
import { weekdayName } from '@/lib/locale';

/**
 * A month as a grid of day dots (identity sheet 13, Grid): one round dot per day in that day's mood colour, a thin
 * outline ring for a day without entry, a 2 pt accent ring for today (with a small "+" while today has no entry).
 * Home and the Calendar tab share it; `numbers` prints the day number inside the dots (Calendar).
 */
export function MonthDots({
  year,
  month,
  weekStart,
  locale,
  today,
  colorOf,
  onPressDay,
  testIDPrefix,
  labelOf,
  numbers,
  dot = 30,
}: {
  year: number;
  month: number;
  weekStart: WeekStart;
  locale: string;
  /** Calendar today (YYYY-MM-DD). */
  today: string;
  /** Mood colour of the day, or null when nothing was logged. */
  colorOf: (date: string) => string | null;
  onPressDay: (date: string, isToday: boolean) => void;
  testIDPrefix: string;
  labelOf: (date: string, hasEntry: boolean) => string;
  numbers?: boolean;
  dot?: number;
}) {
  const theme = useTheme();
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => ((weekStart - 1 + i) % 7) + 1);
  return (
    <View style={styles.grid}>
      <View style={styles.week}>
        {weekdays.map((w) => (
          <Text key={w} style={[styles.weekday, { color: theme.textSecondary }]}>
            {weekdayName(locale, w, 'narrow')}
          </Text>
        ))}
      </View>
      {monthGrid(year, month, weekStart).map((row, r) => (
        <View key={r} style={styles.week}>
          {row.map((date, c) => {
            if (!date) return <View key={c} style={styles.cell} />;
            const color = colorOf(date);
            const isToday = date === today;
            const future = date > addDays(today, 1);
            const size = { width: dot, height: dot, borderRadius: dot / 2 };
            return (
              <View key={date} style={styles.cell}>
                <Pressable
                  testID={`${testIDPrefix}${date}`}
                  accessibilityRole="button"
                  accessibilityLabel={labelOf(date, color !== null)}
                  disabled={future}
                  hitSlop={4}
                  onPress={() => onPressDay(date, isToday)}
                  style={({ pressed }) => [
                    styles.dot,
                    size,
                    color ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: theme.border },
                    isToday && { borderWidth: 2, borderColor: theme.tint },
                    future && styles.future,
                    pressed && styles.pressed,
                  ]}>
                  {color && numbers ? (
                    <Text style={[styles.num, { color: readableOn(color) }]}>{Number(date.slice(8))}</Text>
                  ) : null}
                  {!color && numbers ? <Text style={[styles.num, { color: theme.textSecondary }]}>{Number(date.slice(8))}</Text> : null}
                  {!color && isToday && !numbers ? <Text style={[styles.plus, { color: theme.tintText }]}>+</Text> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.two },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, fontFamily: BrandFonts.body },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { alignItems: 'center', justifyContent: 'center' },
  num: { fontSize: 12, fontWeight: '700', fontFamily: BrandFonts.numerals, fontVariant: ['tabular-nums'] },
  plus: { fontSize: 18, lineHeight: 20, fontWeight: '700', fontFamily: BrandFonts.body },
  future: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
});
