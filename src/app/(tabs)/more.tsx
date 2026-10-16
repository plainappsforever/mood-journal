import { router, type Href } from 'expo-router';
import { Alert, Platform } from 'react-native';

import { useAutoBackupFailed } from '@/components/auto-backup-section';
import { Card, Row, Screen } from '@/components/ui';
import { useT } from '@/hooks/use-t';
import { requestPinWidget } from '@/lib/widgets';

// More (SPEC Screens): Goals · Moods · Activities · Reminders · Lock · Backup & export · Import from Daylio · Appearance · About.
export default function More() {
  const t = useT();
  const failed = useAutoBackupFailed();
  const go = (path: string) => () => router.push(path as Href);
  return (
    <Screen testID="more-screen">
      <Card>
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
      </Card>
    </Screen>
  );
}
