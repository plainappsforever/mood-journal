import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { Card, Row, Screen, Small } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { levelDetail, preparePeriod } from '@/engine/stats';
import { useActivities, useFormatter, useMoods, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { today as journalToday } from '@/lib/clock';
import { formatDayShort } from '@/lib/locale';
import { makePeriod, periodFromParams } from '@/lib/periods';
import { statEntries } from '@/lib/stat-cache';

// Level detail (Formula 10): activities most often in entries of this level.
export default function LevelStats() {
  const params = useLocalSearchParams<{ n: string; start?: string; end?: string; kind?: string }>();
  const db = useSQLiteContext();
  const { t, locale } = useFormatter();
  const settings = useSettings();
  const moods = useMoods();
  const activities = useActivities();
  const all = useLoad(() => statEntries(db), []);
  const level = Number(params.n);
  const period = periodFromParams(params, makePeriod('30d', journalToday(settings.dayEndHour), null));
  const rows = useMemo(() => (all ? levelDetail(preparePeriod(all, period), level) : null), [all, level, period.start, period.end]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows || !moods || !activities) return <Screen>{null}</Screen>;
  const mood = moods.firstOfLevel.get(level);
  return (
    <Screen testID="level-stats">
      <Stack.Screen options={{ title: `${mood?.emoji ?? ''} ${mood?.name ?? level}` }} />
      <Small>{`${formatDayShort(locale, period.start)} – ${formatDayShort(locale, period.end)}`}</Small>
      <Small>{t('stats.level.related')}</Small>
      <Card testID="level-related">
        {rows.length === 0 ? <Small>{t('stats.average.none')}</Small> : null}
        {rows.map((r) => {
          const a = activities.byId.get(r.activityId);
          return <Row key={r.activityId} testID={`related-${r.activityId}`} label={`${a?.emoji ?? ''} ${a?.name ?? '?'}`} value={`${Math.round(r.share * 100)} %`} />;
        })}
      </Card>
    </Screen>
  );
}
