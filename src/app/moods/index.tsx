import { router, Stack, type Href } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { MoodFace } from '@/components/mood-face';
import { Card, Row, Screen, SectionTitle } from '@/components/ui';
import { useMoods } from '@/hooks/use-journal';
import { useT } from '@/hooks/use-t';

// Moods by level (5 = best). Any number of moods per level; each level keeps ≥ 1 active mood (D36).
export default function Moods() {
  const t = useT();
  const moods = useMoods();
  return (
    <Screen testID="moods-screen">
      <Stack.Screen options={{ title: t('moods.title') }} />
      {[5, 4, 3, 2, 1].map((level) => (
        <View key={level}>
          <SectionTitle>{t('moods.level', { n: level })}</SectionTitle>
          <Card>
            {(moods?.all ?? [])
              .filter((m) => m.level === level)
              .map((m) => (
                <Row
                  key={m.id}
                  testID={`mood-row-${m.id}`}
                  left={<MoodFace mood={m} size={32} />}
                  label={m.name}
                  value={m.archived ? t('common.archived') : undefined}
                  onPress={() => router.push(`/moods/${m.id}` as Href)}
                />
              ))}
          </Card>
        </View>
      ))}
      <Button testID="mood-add" label={t('moods.add')} onPress={() => router.push('/moods/new' as Href)} />
    </Screen>
  );
}
