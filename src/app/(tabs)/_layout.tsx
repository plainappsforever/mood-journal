import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';

import { useAutoBackupFailed } from '@/components/auto-backup-section';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/hooks/use-t';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text allowFontScaling={false} style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

// Bottom tabs Entries · Calendar · Stats · More (SPEC Screens).
export default function TabsLayout() {
  const theme = useTheme();
  const t = useT();
  const backupFailed = useAutoBackupFailed();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.backgroundElement },
        headerStyle: { backgroundColor: theme.backgroundElement },
        headerTintColor: theme.text,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}>
      <Tabs.Screen name="entries" options={{ title: t('tabs.entries'), tabBarButtonTestID: 'tab-entries', tabBarIcon: icon('☺') }} />
      <Tabs.Screen name="calendar" options={{ title: t('tabs.calendar'), tabBarButtonTestID: 'tab-calendar', tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="stats" options={{ title: t('tabs.stats'), tabBarButtonTestID: 'tab-stats', tabBarIcon: icon('◔') }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more'), tabBarButtonTestID: 'tab-more', tabBarIcon: icon('≡'), tabBarBadge: backupFailed ? '' : undefined, tabBarBadgeStyle: { minWidth: 10, maxHeight: 10, borderRadius: 5, backgroundColor: theme.danger } }} />
    </Tabs>
  );
}
