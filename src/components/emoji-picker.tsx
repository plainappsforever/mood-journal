import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Field } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/hooks/use-t';

// A curated grid (D28: emoji as icons) plus a free field for any other emoji the keyboard offers.
const EMOJI = [
  '😄', '🙂', '😐', '🙁', '😫', '🤩', '😊', '😌', '🥰', '😎', '🤔', '😴', '🥱', '😢', '😭', '😠', '😤', '😰', '😬', '🤒',
  '💼', '🏃', '🚶', '📖', '🎮', '🍳', '🧹', '🛒', '👪', '👫', '❤️', '🧘', '🛌', '😪', '🌙', '🥗', '🍬', '🍷', '☕', '🍺',
  '🎵', '🎨', '📺', '🎬', '📷', '✈️', '🚗', '🚲', '🏊', '⚽', '🏋️', '🧗', '🌳', '☀️', '🌧️', '❄️', '🐶', '🐱', '🌱', '💊',
  '📚', '✍️', '💻', '📱', '🧠', '🙏', '🎉', '🎁', '💤', '🍕', '🍔', '🥤', '🚭', '💧', '🏠', '🏖️', '⛰️', '🛁', '💇', '🧑‍🍳',
];

export function EmojiPicker({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  const theme = useTheme();
  const t = useT();
  const [custom, setCustom] = useState('');
  return (
    <View style={styles.wrap}>
      <View testID="emoji-grid" style={styles.grid}>
        {EMOJI.map((e, i) => (
          <Pressable
            key={e}
            testID={`emoji-${i}`}
            accessibilityRole="button"
            accessibilityLabel={e}
            accessibilityState={{ selected: e === value }}
            onPress={() => onChange(e)}
            style={[styles.cell, { backgroundColor: e === value ? theme.backgroundSelected : 'transparent' }]}>
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        testID="emoji-custom"
        label={t('emoji.custom')}
        value={custom}
        onChangeText={(text) => {
          setCustom(text);
          if (text.trim()) onChange(text.trim());
        }}
        onSubmitEditing={() => {
          if (custom.trim()) onChange(custom.trim());
        }}
        maxLength={8}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '10%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  emoji: { fontSize: 22 },
});
