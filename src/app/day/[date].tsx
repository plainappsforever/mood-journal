import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { EntryRow } from '@/components/entry-row';
import { Label, Screen, Title } from '@/components/ui';
import { listEntries } from '@/db/entries';
import { useSQLiteContext } from '@/db/provider';
import { addDays, isValidDate } from '@/engine/dates';
import { useActivities, useFormatter, useMoods } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { calendarToday } from '@/lib/clock';
import { formatDayLong } from '@/lib/locale';

// Day sheet (from the calendar / pixels): the day's entries and "Add entry for this day" (SPEC flow 3). Presented as a
// form sheet by the root Stack (no header there, so the date is the sheet's own title).
export default function Day() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const db = useSQLiteContext();
  const { t, locale } = useFormatter();
  const moods = useMoods();
  const activities = useActivities();
  const valid = isValidDate(date);
  const entries = useLoad(() => (valid ? listEntries(db, { from: date, to: date }) : Promise.resolve([])), [date]);
  const today = calendarToday();
  if (!valid || !moods || !activities || !entries) return <Screen>{null}</Screen>;
  return (
    <Screen testID="day-screen">
      <Stack.Screen options={{ title: formatDayLong(locale, date, today) }} />
      <Title testID="day-title">{formatDayLong(locale, date, today)}</Title>
      {entries.length === 0 ? <Label muted>{t('day.empty')}</Label> : null}
      <View style={{ gap: 8 }}>
        {[...entries].reverse().map((e) => (
          <EntryRow key={e.id} entry={e} moods={moods} activities={activities} locale={locale} onPress={() => router.push(`/entry/${e.id}` as Href)} />
        ))}
      </View>
      {date <= addDays(today, 1) ? <Button testID="day-add-entry" label={t('day.add')} onPress={() => router.push(`/entry/new?date=${date}` as Href)} /> : null}
    </Screen>
  );
}
