import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MoodFace } from '@/components/mood-face';
import { BrandFonts, Radius } from '@/constants/theme';
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
          <View style={styles.timeBox}>
            {mood ? <View style={[styles.dot, { backgroundColor: mood.color }]} /> : null}
            <Text style={[styles.time, { color: theme.textSecondary }]}>{formatClock(locale, entry.localTime)}</Text>
          </View>
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
  row: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: Radius.card, alignItems: 'flex-start' },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  mood: { fontSize: 16, fontWeight: '600', fontFamily: BrandFonts.body },
  timeBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  time: { fontSize: 14, fontFamily: BrandFonts.numerals, fontVariant: ['tabular-nums'] },
  acts: { fontSize: 14, fontFamily: BrandFonts.body },
  note: { fontSize: 14, fontFamily: BrandFonts.body },
  thumb: { width: 48, height: 48, borderRadius: 12 },
  pressed: { opacity: 0.7 },
});
