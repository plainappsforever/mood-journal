import { Tabs } from 'expo-router/js-tabs';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Platform, Text, type ColorValue } from 'react-native';

import { useAutoBackupFailed } from '@/components/auto-backup-section';
import { BrandFonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/hooks/use-t';

// iOS: SF Symbols from the identity sheet (circle.grid.3x3, calendar, chart.bar, ellipsis); Android keeps the text glyphs.
const icon = (symbol: SFSymbol, glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    if (Platform.OS === 'ios') return <SymbolView name={symbol} size={22} tintColor={color} />;
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
        tabBarActiveTintColor: theme.tintText,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.backgroundElement, borderTopColor: theme.border },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontFamily: BrandFonts.title },
        headerShadowVisible: false,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', fontFamily: BrandFonts.body },
      }}>
      <Tabs.Screen name="entries" options={{ title: t('tabs.entries'), tabBarButtonTestID: 'tab-entries', tabBarIcon: icon('circle.grid.3x3', '☺') }} />
      <Tabs.Screen name="calendar" options={{ title: t('tabs.calendar'), tabBarButtonTestID: 'tab-calendar', tabBarIcon: icon('calendar', '▦') }} />
      <Tabs.Screen name="stats" options={{ title: t('tabs.stats'), tabBarButtonTestID: 'tab-stats', tabBarIcon: icon('chart.bar', '◔') }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more'), tabBarButtonTestID: 'tab-more', tabBarIcon: icon('ellipsis', '≡'), tabBarBadge: backupFailed ? '' : undefined, tabBarBadgeStyle: { minWidth: 10, maxHeight: 10, borderRadius: 5, backgroundColor: theme.danger } }} />
    </Tabs>
  );
}
