import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Mood } from '@/db/moods';
import { useTheme } from '@/hooks/use-theme';

/** A mood's emoji on its colour; `selected` adds a ring. */
export function MoodFace({
  mood,
  size = 52,
  selected,
  onPress,
  onLongPress,
  testID,
  label,
}: {
  mood: Pick<Mood, 'emoji' | 'color' | 'name'>;
  size?: number;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
  label?: boolean;
}) {
  const theme = useTheme();
  const face = (
    <View
      style={[
        styles.face,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: mood.color, borderColor: selected ? theme.text : 'transparent' },
      ]}>
      {/* review N4: the emoji fills a fixed circle, so it does not grow with the text size (the name below does) */}
      <Text allowFontScaling={false} style={{ fontSize: size * 0.5 }}>
        {mood.emoji}
      </Text>
    </View>
  );
  if (!onPress && !onLongPress) return face;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={mood.name}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      {face}
      {label ? (
        <Text numberOfLines={1} style={[styles.name, { color: selected ? theme.text : theme.textSecondary, maxWidth: size + 20 }]}>
          {mood.name}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  face: { alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  name: { fontSize: 12, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
