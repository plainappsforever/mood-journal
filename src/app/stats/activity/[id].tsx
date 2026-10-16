import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { MoodFace } from '@/components/mood-face';
import { Card, Label, Row, Screen, SectionTitle, Segmented, Small } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { activityDetail, comparisonLabel, comparisonSentence, preparePeriod, type CompareMode } from '@/engine/stats';
import { useActivities, useFormatter, useMoods, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { today as journalToday } from '@/lib/clock';
import { formatDayShort } from '@/lib/locale';
import { makePeriod, periodFromParams } from '@/lib/periods';
import { statEntries } from '@/lib/stat-cache';

// Activity detail (SPEC flow 4, Formula 8–9): with/without in three modes with counts and an honest label (L26).
export default function ActivityStats() {
  const params = useLocalSearchParams<{ id: string; start?: string; end?: string; kind?: string }>();
  const db = useSQLiteContext();
  const f = useFormatter();
  const { t, locale } = f;
  const settings = useSettings();
  const moods = useMoods();
  const activities = useActivities();
  const all = useLoad(() => statEntries(db), []);
  const [mode, setMode] = useState<CompareMode>('entries');
  const period = periodFromParams(params, makePeriod('30d', journalToday(settings.dayEndHour), null));
  const id = Number(params.id);
  const detail = useMemo(() => (all ? activityDetail(preparePeriod(all, period), id) : null), [all, id, period.start, period.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const activity = activities?.byId.get(id);
  if (!detail || !activity || !moods || !activities) return <Screen>{null}</Screen>;
  const c = mode === 'entries' ? detail.entries : mode === 'sameDay' ? detail.sameDay : detail.nextDay;
  const sentence = comparisonSentence(f, c, activity.name);
  return (
    <Screen testID="activity-stats">
      <Stack.Screen options={{ title: `${activity.emoji} ${activity.name}` }} />
      <Small>{`${formatDayShort(locale, period.start)} – ${formatDayShort(locale, period.end)}`}</Small>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'entries', label: t('stats.cmp.mode.entries'), testID: 'cmp-entries' },
          { value: 'sameDay', label: t('stats.cmp.mode.sameDay'), testID: 'cmp-sameday' },
          { value: 'nextDay', label: t('stats.cmp.mode.nextDay'), testID: 'cmp-nextday' },
        ]}
      />
      <Card testID="cmp-result">
        <Label testID="cmp-label">{comparisonLabel(f, c)}</Label>
        {sentence ? <Label testID="cmp-sentence">{sentence}</Label> : null}
        <Small>{t('stats.cmp.note')}</Small>
      </Card>
      <SectionTitle>{t('stats.card.together')}</SectionTitle>
      <Card testID="often-together">
        {detail.together.length === 0 ? <Small>{t('stats.together.none')}</Small> : null}
        {detail.together.slice(0, 10).map((r) => {
          const a = activities.byId.get(r.activityId);
          return <Row key={r.activityId} label={`${a?.emoji ?? ''} ${a?.name ?? '?'}`} value={t('stats.together.share', { share: Math.round(r.share * 100), activity: activity.name })} />;
        })}
      </Card>
      <SectionTitle>{t('stats.card.counts')}</SectionTitle>
      <Card testID="activity-counts">
        {[5, 4, 3, 2, 1].map((level) => {
          const mood = moods.firstOfLevel.get(level);
          return <Row key={level} left={mood ? <MoodFace mood={mood} size={24} /> : undefined} label={mood?.name ?? String(level)} value={String(detail.counts.byLevel[level as 1 | 2 | 3 | 4 | 5])} />;
        })}
      </Card>
    </Screen>
  );
}
