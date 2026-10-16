import { router, Stack, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { EntryRow } from '@/components/entry-row';
import { Chip, Field, Screen, SectionTitle, Small, Wrap } from '@/components/ui';
import { getEntries, searchCandidates } from '@/db/entries';
import { useSQLiteContext } from '@/db/provider';
import { addDays } from '@/engine/dates';
import { findMatches, matches } from '@/engine/search';
import { useActivities, useFormatter, useMoods, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { calendarToday, today as journalToday } from '@/lib/clock';
import { formatDayRelative } from '@/lib/locale';

const MAX_RESULTS = 100;

// Search (SPEC Screens): note + title, diacritics-insensitive, filters by level, activity and dates; matches highlighted.
export default function Search() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { t, locale } = useFormatter();
  const settings = useSettings();
  const moods = useMoods();
  const activities = useActivities();
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<number[]>([]);
  const [activityId, setActivityId] = useState<number | null>(null);
  const [showActivities, setShowActivities] = useState(false);
  const [dates, setDates] = useState<'all' | '30d' | 'year'>('all');
  const today = journalToday(settings.dayEndHour);
  const from = dates === '30d' ? addDays(today, -29) : dates === 'year' ? addDays(today, -364) : undefined;

  const result = useLoad(async () => {
    const candidates = await searchCandidates(db, { from, levels, activityId });
    const hit = candidates.filter((c) => matches(`${c.noteTitle}\n${c.note}`, query));
    return { total: hit.length, entries: await getEntries(db, hit.slice(0, MAX_RESULTS).map((c) => c.id)) };
  }, [query, levels.join(','), activityId, from]);

  const highlight = useMemo(
    () => (text: string) => {
      const ranges = findMatches(text, query);
      if (!ranges.length) return text;
      const parts: React.ReactNode[] = [];
      let at = 0;
      ranges.forEach((r, i) => {
        parts.push(text.slice(at, r.start));
        parts.push(
          <Text key={i} testID="search-highlight" style={{ backgroundColor: theme.tint, color: theme.onTint }}>
            {text.slice(r.start, r.end)}
          </Text>
        );
        at = r.end;
      });
      parts.push(text.slice(at));
      return parts;
    },
    [query, theme]
  );

  if (!moods || !activities) return <Screen>{null}</Screen>;
  const picked = activityId ? activities.byId.get(activityId) : null;
  return (
    <Screen testID="search-screen">
      <Stack.Screen options={{ title: t('search.title') }} />
      <Field testID="search-input" placeholder={t('search.placeholder')} value={query} onChangeText={setQuery} autoFocus autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
      <Wrap>
        {[5, 4, 3, 2, 1].map((n) => {
          const m = moods.firstOfLevel.get(n);
          const on = levels.includes(n);
          return <Chip key={n} testID={`filter-level-${n}`} label={m?.emoji ?? String(n)} accessibilityLabel={m?.name} selected={on} onPress={() => setLevels(on ? levels.filter((l) => l !== n) : [...levels, n])} />;
        })}
        <Chip testID="filter-activity" label={picked ? `${picked.emoji} ${picked.name}` : t('search.activity')} selected={!!picked} onPress={() => (picked ? setActivityId(null) : setShowActivities(!showActivities))} />
        <Chip testID="filter-dates" label={t(`search.dates.${dates}`)} selected={dates !== 'all'} onPress={() => setDates(dates === 'all' ? '30d' : dates === '30d' ? 'year' : 'all')} />
      </Wrap>
      {showActivities && !picked ? (
        <Wrap>
          {activities.all
            .filter((a) => !a.archived)
            .map((a) => (
              <Chip key={a.id} testID={`filter-activity-${a.id}`} label={`${a.emoji} ${a.name}`} onPress={() => { setActivityId(a.id); setShowActivities(false); }} />
            ))}
        </Wrap>
      ) : null}
      {result ? <SectionTitle>{t('search.count', { n: result.total })}</SectionTitle> : null}
      {result && result.total > MAX_RESULTS ? <Small>{t('search.more', { n: MAX_RESULTS })}</Small> : null}
      <View style={{ gap: 8 }}>
        {result?.entries.map((e) => (
          <View key={e.id} testID={`search-result-${e.id}`}>
            <Small>{formatDayRelative(t, locale, e.localDate, calendarToday())}</Small>
            <EntryRow entry={e} moods={moods} activities={activities} locale={locale} highlight={query.trim() ? highlight : undefined} onPress={() => router.push(`/entry/${e.id}` as Href)} />
          </View>
        ))}
      </View>
    </Screen>
  );
}
