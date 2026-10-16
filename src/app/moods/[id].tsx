import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmojiPicker } from '@/components/emoji-picker';
import { MoodFace } from '@/components/mood-face';
import { Chip, Field, Label, Screen, SectionTitle, Small, Wrap } from '@/components/ui';
import { MOOD_COLORS } from '@/constants/palettes';
import { addMood, countEntriesForMood, mergeMood, moveMood, setMoodArchived, setMoodLevel, updateMood, type Mood } from '@/db/moods';
import { useSQLiteContext } from '@/db/provider';
import { useMoods, type MoodBook } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/hooks/use-t';
import { now } from '@/lib/clock';
import { showError } from '@/lib/errors';
import { write } from '@/lib/write';

export default function MoodEditorRoute() {
  const { id, level } = useLocalSearchParams<{ id: string; level?: string }>();
  const db = useSQLiteContext();
  const moods = useMoods();
  const isNew = id === 'new';
  const mood = isNew ? null : (moods?.byId.get(Number(id)) ?? null);
  const uses = useLoad(() => (mood ? countEntriesForMood(db, mood.id) : Promise.resolve(null)), [mood?.id]);
  if (!moods || (!isNew && !mood)) return <Screen>{null}</Screen>;
  return <MoodEditor key={mood?.id ?? 'new'} mood={mood} moods={moods} uses={uses} defaultLevel={Number(level) || 3} />;
}

function MoodEditor({ mood, moods, uses, defaultLevel }: { mood: Mood | null; moods: MoodBook; uses: number | null; defaultLevel: number }) {
  const isNew = mood === null;
  const db = useSQLiteContext();
  const t = useT();
  const theme = useTheme();
  const [name, setName] = useState(mood?.name ?? '');
  const [emoji, setEmoji] = useState(mood?.emoji ?? '🙂');
  const [color, setColor] = useState<string>(mood?.color ?? MOOD_COLORS[0]);
  const [level, setLevel] = useState(mood?.level ?? defaultLevel);
  const [showEmoji, setShowEmoji] = useState(false);
  const [merging, setMerging] = useState(false);

  const save = async () => {
    try {
      if (isNew) {
        await write(() => addMood(db, { level, name, emoji, color }, now()));
        router.back();
        return;
      }
      if (!mood) return;
      await write(() => updateMood(db, mood.id, { name, emoji, color }));
      if (level !== mood.level) {
        const n = uses ?? 0;
        Alert.alert(t('moods.relevelTitle'), t('moods.relevelText', { n, level }), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.ok'),
            onPress: async () => {
              try {
                await write(() => setMoodLevel(db, mood.id, level));
                router.back();
              } catch (e) {
                showError(t, e);
              }
            },
          },
        ]);
        return;
      }
      router.back();
    } catch (e) {
      showError(t, e);
    }
  };

  const others = moods.all.filter((m) => m.id !== mood?.id && !m.archived);
  const moodsOfLevel = mood ? moods.all.filter((m) => m.level === mood.level).length : 0;

  return (
    <Screen testID="mood-editor">
      <Stack.Screen options={{ title: isNew ? t('moods.add') : t('moods.edit') }} />
      <View style={styles.preview}>
        <MoodFace mood={{ name, emoji, color }} size={72} />
      </View>
      <Field testID="mood-name" label={t('moods.name')} value={name} onChangeText={setName} maxLength={40} />
      <Pressable testID="mood-emoji" accessibilityRole="button" onPress={() => setShowEmoji(!showEmoji)}>
        <Label>{`${t('moods.emoji')}: ${emoji}`}</Label>
      </Pressable>
      {showEmoji ? (
        <EmojiPicker
          value={emoji}
          onChange={(e) => {
            setEmoji(e);
            setShowEmoji(false);
          }}
        />
      ) : null}
      <SectionTitle>{t('moods.color')}</SectionTitle>
      <View testID="mood-color" style={styles.colors}>
        {MOOD_COLORS.map((c, i) => (
          <Pressable
            key={c}
            testID={`mood-color-${i}`}
            accessibilityRole="button"
            accessibilityLabel={c}
            accessibilityState={{ selected: c === color }}
            onPress={() => setColor(c)}
            style={[styles.swatch, { backgroundColor: c, borderColor: c === color ? theme.text : 'transparent' }]}
          />
        ))}
      </View>
      <SectionTitle>{t('moods.levelPick')}</SectionTitle>
      <Wrap>
        {[5, 4, 3, 2, 1].map((n) => (
          <Chip key={n} testID={`mood-level-pick-${n}`} label={t('moods.level', { n })} selected={level === n} onPress={() => setLevel(n)} />
        ))}
      </Wrap>
      {uses !== null ? <Small>{t('moods.uses', { n: uses })}</Small> : null}
      <Button testID="mood-save" label={t('common.save')} disabled={!name.trim()} onPress={() => void save()} />
      {mood && (moodsOfLevel ?? 0) > 1 ? (
        <Wrap>
          <Chip testID="mood-move-up" label={t('common.moveUp')} onPress={() => void write(() => moveMood(db, mood.id, -1)).catch((e) => showError(t, e))} />
          <Chip testID="mood-move-down" label={t('common.moveDown')} onPress={() => void write(() => moveMood(db, mood.id, 1)).catch((e) => showError(t, e))} />
          <Small>{t('moods.orderHint')}</Small>
        </Wrap>
      ) : null}
      {mood ? (
        <>
          <Button
            testID="mood-archive"
            variant="secondary"
            label={mood.archived ? t('common.unarchive') : t('common.archive')}
            onPress={async () => {
              try {
                await write(() => setMoodArchived(db, mood.id, !mood.archived));
                router.back();
              } catch (e) {
                showError(t, e);
              }
            }}
          />
          <Button testID="mood-merge" variant="secondary" label={t('moods.merge')} onPress={() => setMerging(!merging)} />
          {merging ? (
            <View style={styles.merge}>
              <Small>{t('moods.mergeHint', { n: uses ?? 0 })}</Small>
              <Wrap>
                {others.map((m) => (
                  <Chip
                    key={m.id}
                    testID={`merge-into-${m.id}`}
                    label={`${m.emoji} ${m.name}`}
                    onPress={() =>
                      Alert.alert(t('moods.mergeTitle'), t('moods.mergeText', { n: uses ?? 0, from: mood.name, into: m.name }), [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('moods.mergeConfirm'),
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await write(() => mergeMood(db, mood.id, m.id, now()));
                              router.back();
                            } catch (e) {
                              showError(t, e);
                            }
                          },
                        },
                      ])
                    }
                  />
                ))}
              </Wrap>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center' },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  merge: { gap: 8 },
});
