import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MoodFace } from '@/components/mood-face';
import type { Entry } from '@/db/entries';
import type { ActivityBook, MoodBook } from '@/hooks/use-journal';
import { useTheme } from '@/hooks/use-theme';
import { formatClock } from '@/lib/locale';
import { photoUri } from '@/lib/photos';

/** Timeline row: mood face + name, time, activity emojis, note preview, first photo. */
export function EntryRow({
  entry,
  moods,
  activities,
  locale,
  onPress,
  highlight,
}: {
  entry: Entry;
  moods: MoodBook;
  activities: ActivityBook;
  locale: string;
  onPress: () => void;
  highlight?: (text: string) => React.ReactNode;
}) {
  const theme = useTheme();
  const mood = moods.byId.get(entry.moodId);
  const acts = entry.activityIds.map((id) => activities.byId.get(id)).filter((a) => !!a);
  const preview = [entry.noteTitle, entry.note].filter(Boolean).join(' · ');
  const photo = entry.photos[0];
  return (
    <Pressable
      testID={`entry-row-${entry.id}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
      {mood ? <MoodFace mood={mood} size={40} /> : null}
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={[styles.mood, { color: theme.text }]}>{mood?.name ?? '?'}</Text>
          <Text style={[styles.time, { color: theme.textSecondary }]}>{formatClock(locale, entry.localTime)}</Text>
        </View>
        {acts.length ? (
          <Text numberOfLines={2} style={[styles.acts, { color: theme.textSecondary }]}>
            {acts.map((a) => `${a.emoji} ${a.name}`).join('  ')}
          </Text>
        ) : null}
        {preview ? (
          <Text numberOfLines={2} style={[styles.note, { color: theme.text }]}>
            {highlight ? highlight(preview) : preview}
          </Text>
        ) : null}
      </View>
      {photo ? <Image source={{ uri: photoUri(photo.file) }} style={styles.thumb} contentFit="cover" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 14, alignItems: 'flex-start' },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  mood: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 14 },
  acts: { fontSize: 14 },
  note: { fontSize: 14 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  pressed: { opacity: 0.7 },
});
