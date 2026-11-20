import { router, type Href } from 'expo-router';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useAutoBackupFailed } from '@/components/auto-backup-section';
import { Row } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/hooks/use-t';
import { requestPinWidget } from '@/lib/widgets';

// More (SPEC Screens), settings layout B (identity sheet 13): a tall sheet with a grabber over a darker backdrop. Rows: Goals · Moods · Activities · Reminders · Lock · Backup & export · Import from Daylio · Appearance · About.
export default function More() {
  const t = useT();
  const theme = useTheme();
  const failed = useAutoBackupFailed();
  const go = (path: string) => () => router.push(path as Href);
  return (
    <View style={[styles.backdrop, { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        <ScrollView testID="more-screen" contentContainerStyle={styles.content}>
        <View>
        <Row testID="more-goals" label={t('goals.title')} onPress={go('/goals')} />
        <Row testID="more-moods" label={t('moods.title')} onPress={go('/moods')} />
        <Row testID="more-activities" label={t('activities.title')} onPress={go('/activities')} />
        <Row testID="more-reminders" label={t('reminders.title')} onPress={go('/reminders')} />
        <Row testID="more-lock" label={t('lock.title')} onPress={go('/settings/lock')} />
        <Row testID="more-backup" label={t('backup.title')} value={failed ? `● ${t('more.attention')}` : undefined} danger={failed} onPress={go('/backup')} />
        <Row testID="more-import" label={t('import.title')} onPress={go('/import')} />
        <Row testID="more-appearance" label={t('appearance.title')} onPress={go('/appearance')} />
        <Row testID="more-about" label={t('about.title')} onPress={go('/about')} />
        {Platform.OS === 'android' ? (
          <Row
            testID="more-widget"
            label={t('more.widget')}
            onPress={() => {
              const r = requestPinWidget();
              if (r === 'alreadyAdded') Alert.alert(t('more.widget'), t('more.widgetAdded'));
              else if (r !== 'requested') Alert.alert(t('more.widget'), t('more.widgetUnsupported'));
            }}
          />
        ) : null}
        </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingTop: Spacing.two },
  sheet: { flex: 1, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginTop: Spacing.two },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.six },
});
