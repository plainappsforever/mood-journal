import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Chip, Screen, SectionTitle, Small, Wrap } from '@/components/ui';
import { PALETTE_NAMES, PALETTES, type PaletteName } from '@/constants/palettes';
import { listMoods, updateMood } from '@/db/moods';
import { useSQLiteContext } from '@/db/provider';
import { getSetting, getThemePreference, setJournalSetting, setSetting, setThemePreference, type ThemePreference } from '@/db/settings';
import type { WeekStart } from '@/engine/dates';
import { useFormatter, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { formatClock, weekdayName } from '@/lib/locale';
import { applyThemePreference } from '@/lib/theme-preference';
import { write } from '@/lib/write';

export default function Appearance() {
  const db = useSQLiteContext();
  const { t, locale } = useFormatter();
  const settings = useSettings();
  const theme = useLoad(() => getThemePreference(db), []);
  const palette = useLoad(() => getSetting(db, 'palette'), []);

  const setTheme = async (value: ThemePreference) => {
    await write(() => setThemePreference(db, value));
    applyThemePreference(value);
  };
  const applyPalette = async (name: PaletteName) => {
    await write(async () => {
      for (const m of await listMoods(db, { includeArchived: true })) {
        await updateMood(db, m.id, { name: m.name, emoji: m.emoji, color: PALETTES[name][m.level - 1] });
      }
      await setSetting(db, 'palette', name);
    });
  };

  return (
    <Screen testID="appearance-screen">
      <Stack.Screen options={{ title: t('appearance.title') }} />
      <SectionTitle>{t('appearance.theme')}</SectionTitle>
      <Wrap>
        {(['system', 'light', 'dark'] as const).map((v) => (
          <Chip key={v} testID={`theme-${v}`} label={t(`appearance.theme.${v}`)} selected={theme === v} onPress={() => void setTheme(v)} />
        ))}
      </Wrap>
      <SectionTitle>{t('appearance.palette')}</SectionTitle>
      <Card>
        {PALETTE_NAMES.map((name) => (
          <View key={name} style={styles.palette}>
            <Chip testID={`palette-${name}`} label={t(`appearance.palette.${name}`)} selected={palette === name} onPress={() => void applyPalette(name)} />
            <View style={styles.swatches}>
              {[...PALETTES[name]].reverse().map((c) => (
                <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
              ))}
            </View>
          </View>
        ))}
        <Small>{t('appearance.paletteHint')}</Small>
      </Card>
      <SectionTitle>{t('appearance.weekStart')}</SectionTitle>
      <View testID="week-start">
        <Wrap>
          {([1, 6, 7] as WeekStart[]).map((d) => (
            <Chip key={d} testID={`week-start-${d}`} label={weekdayName(locale, d, 'long')} selected={settings.weekStart === d} onPress={() => void write(() => setJournalSetting(db, 'weekStart', d))} />
          ))}
        </Wrap>
      </View>
      <SectionTitle>{t('appearance.dayEnd')}</SectionTitle>
      <View testID="day-end-hour">
        <Wrap>
          {[0, 1, 2, 3, 4].map((h) => (
            <Chip
              key={h}
              testID={`day-end-${h}`}
              label={h === 0 ? t('appearance.dayEnd.midnight') : formatClock(locale, `0${h}:00`)}
              selected={settings.dayEndHour === h}
              onPress={() => void write(() => setJournalSetting(db, 'dayEndHour', h))}
            />
          ))}
        </Wrap>
      </View>
      <Small>{t('appearance.dayEndHint')}</Small>
      <SectionTitle>{t('appearance.language')}</SectionTitle>
      <Small>{t('appearance.languageHint')}</Small>
    </Screen>
  );
}

const styles = StyleSheet.create({
  palette: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swatches: { flexDirection: 'row', gap: 4 },
  swatch: { width: 22, height: 22, borderRadius: 11 },
});
