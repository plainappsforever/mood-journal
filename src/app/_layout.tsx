import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getCalendars } from 'expo-localization';
import { useEffect } from 'react';
import { LogBox, useColorScheme } from 'react-native';

import { AppLockGate } from '@/components/app-lock-gate';
import { DatabaseProvider, useSQLiteContext } from '@/db/provider';
import { migrate } from '@/db/migrations';
import { seedDefaults } from '@/db/seed';
import { getThemePreference, setJournalSetting } from '@/db/settings';
import type { WeekStart } from '@/engine/dates';
import { useT } from '@/hooks/use-t';
import { initLanguage, syncLayoutDirection } from '@/lib/locale';
import { configureNotifications } from '@/lib/notifications';
import { startAutoBackup } from '@/lib/auto-backup';
import { startReminders } from '@/lib/reminders';
import { startWidgets } from '@/lib/widgets';
import { applyThemePreference } from '@/lib/theme-preference';

// Dev-only toast from expo-router's start-up link handling when the app is opened by a link (same as invoice-maker P5).
LogBox.ignoreLogs(["Can't perform a React state update on a component that hasn't mounted yet"]);

// A link that opens the app cold (widget face, notification) still has the tabs beneath it, so Save / Back lands on
// Home instead of leaving an empty stack.
export const unstable_settings = { anchor: '(tabs)' };

configureNotifications();
const language = initLanguage(); // UI language follows the device (SPEC Appearance)
syncLayoutDirection(language); // Android: Arabic mirrored (P10)

/** expo-localization firstWeekday: 1 = Sunday … 7 = Saturday → our 1 (Mon) / 6 (Sat) / 7 (Sun). */
function localeWeekStart(): WeekStart {
  try {
    const first = getCalendars()[0]?.firstWeekday;
    return first === 1 ? 7 : first === 7 ? 6 : 1;
  } catch {
    return 1;
  }
}

async function initDatabase(db: SQLiteDatabase) {
  await migrate(db);
  // Defaults in the device language on the very first start (D40); no dialog, no onboarding (A2).
  if (await seedDefaults(db, language, Date.now())) await setJournalSetting(db, 'weekStart', localeWeekStart());
  applyThemePreference(await getThemePreference(db));
}

export default function RootLayout() {
  return (
    <DatabaseProvider onInit={initDatabase}>
      <Navigator />
    </DatabaseProvider>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  const t = useT();
  const db = useSQLiteContext();
  // Reminders: rebuild the OS list from the database on start, foreground and every journal change.
  useEffect(() => startReminders(db), [db]);
  // Automatic backup: marks journal changes, runs a due backup when the app goes to the background (SPEC flow 7).
  useEffect(() => startAutoBackup(db), [db]);
  // Widgets (SPEC flow 10): pushed on start, foreground and every journal change.
  useEffect(() => startWidgets(db), [db]);
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppLockGate>
        <Stack screenOptions={{ headerBackTitle: t('nav.back') }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('tabs.entries') }} />
          <Stack.Screen name="debug/[action]" options={{ title: 'Debug' }} />
          {/* Day view as a sheet (SPEC Screens): declared here, not from inside the screen (D59 found that half-pushed). */}
          <Stack.Screen name="day/[date]" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.55, 1], sheetGrabberVisible: true, sheetCornerRadius: 16, headerShown: false }} />
        </Stack>
      </AppLockGate>
    </ThemeProvider>
  );
}
