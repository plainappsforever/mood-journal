// Small shared building blocks for every screen (one look, testIDs passed through).
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { BrandFonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Screen({ children, testID, scroll = true }: { children: ReactNode; testID?: string; scroll?: boolean }) {
  const theme = useTheme();
  if (!scroll) {
    return (
      <View testID={testID} style={[styles.flex, { backgroundColor: theme.background }]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      {children}
    </ScrollView>
  );
}

export function Card({ children, testID, style }: { children: ReactNode; testID?: string; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>
      {children}
    </View>
  );
}

export function Title({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <Text testID={testID} style={[styles.title, { color: theme.text }]}>
      {children}
    </Text>
  );
}

export function Label({ children, testID, muted, danger, center }: { children: ReactNode; testID?: string; muted?: boolean; danger?: boolean; center?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      testID={testID}
      style={[styles.label, { color: danger ? theme.danger : muted ? theme.textSecondary : theme.text }, center && styles.center]}>
      {children}
    </Text>
  );
}

export function Small({ children, testID, muted = true, numberOfLines }: { children: ReactNode; testID?: string; muted?: boolean; numberOfLines?: number }) {
  const theme = useTheme();
  return (
    <Text testID={testID} numberOfLines={numberOfLines} style={[styles.small, { color: muted ? theme.textSecondary : theme.text }]}>
      {children}
    </Text>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.section, { color: theme.textSecondary }]}>{children}</Text>;
}

export function Row({
  label,
  value,
  onPress,
  testID,
  left,
  danger,
  accessibilityLabel,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  left?: ReactNode;
  danger?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: theme.border }, pressed && onPress && { backgroundColor: theme.backgroundSelected }]}>
      {left}
      <Text style={[styles.rowLabel, { color: danger ? theme.danger : theme.text }]}>{label}</Text>
      {value ? <Text style={[styles.rowValue, { color: theme.textSecondary }]}>{value}</Text> : null}
      {onPress ? <Text style={{ color: theme.textSecondary, fontFamily: BrandFonts.body }}>›</Text> : null}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.chipText, { color: selected ? theme.onTint : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { value: T; label: string; testID?: string }[];
  value: T;
  onChange: (value: T) => void;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          label={o.label}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
          testID={o.testID ?? (testIDPrefix ? `${testIDPrefix}${o.value}` : undefined)}
        />
      ))}
    </View>
  );
}

export function Field({ label, testID, ...rest }: TextInputProps & { label?: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.small, { color: theme.textSecondary }]}>{label}</Text> : null}
      <TextInput
        testID={testID}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }, rest.multiline && styles.multiline]}
        {...rest}
      />
    </View>
  );
}

export function ToggleRow({ label, value, onChange, testID, disabled, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string; disabled?: boolean; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <View style={styles.flex}>
        <Text style={[styles.rowLabel, { color: disabled ? theme.textSecondary : theme.text }]}>{label}</Text>
        {hint ? <Text style={[styles.small, { color: theme.textSecondary }]}>{hint}</Text> : null}
      </View>
      <Switch testID={testID} value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

export function Wrap({ children }: { children: ReactNode }) {
  return <View style={styles.wrap}>{children}</View>;
}

export function Gap({ size = 2 }: { size?: 1 | 2 | 3 | 4 }) {
  return <View style={{ height: [0, Spacing.one, Spacing.two, Spacing.three, Spacing.four][size] }} />;
}

export const ui = StyleSheet.create({
  flex: { flex: 1 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  title: { fontSize: 22, fontWeight: '700', fontFamily: BrandFonts.title },
  label: { fontSize: 16, lineHeight: 22, fontFamily: BrandFonts.body },
  center: { textAlign: 'center' },
  small: { fontSize: 13, lineHeight: 18, fontFamily: BrandFonts.body },
  section: { fontSize: 13, fontWeight: '700', fontFamily: BrandFonts.body, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 48, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 16, fontFamily: BrandFonts.body, flexShrink: 1, flexGrow: 1, minWidth: '40%' },
  rowValue: { fontSize: 15, fontFamily: BrandFonts.body, flexShrink: 1, textAlign: 'right' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, minHeight: 36, justifyContent: 'center' },
  chipText: { fontSize: 15, fontFamily: BrandFonts.body },
  pressed: { opacity: 0.6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  field: { gap: Spacing.one },
  input: { borderWidth: 1, borderRadius: Radius.control, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minHeight: 44 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
});
