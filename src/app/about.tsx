import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { Alert, Linking } from 'react-native';

import { Card, Label, Row, Screen, SectionTitle, Small } from '@/components/ui';
import { useT } from '@/hooks/use-t';

/**
 * The privacy policy online (review M2, Apple 5.1.1(i): the link must also be inside the app; Play: link in the Console,
 * link or text in the app). Opened in the phone's browser, which is another app: Mood itself has no network code and its
 * Android release build no INTERNET permission. The page is published from docs/RELEASE_KIT.md Appendix D.
 */
export const PRIVACY_URL = 'https://plainapps.dfdsfdsfsdf.workers.dev/apps/mood-journal/privacy';

// About & privacy (SPEC Honest promises, Privacy): promises, disclaimer, what a backup contains, policy link, version.
export default function About() {
  const t = useT();
  const openPrivacy = () => Linking.openURL(PRIVACY_URL).catch(() => Alert.alert(t('about.privacyLink'), PRIVACY_URL));
  return (
    <Screen testID="about-screen">
      <Stack.Screen options={{ title: t('about.title') }} />
      <Card>
        <Label>{t('about.promise.local')}</Label>
        <Label>{t('about.promise.backup')}</Label>
        <Label>{t('about.promise.stats')}</Label>
      </Card>
      <Card testID="about-disclaimer">
        <Label>{t('about.disclaimer')}</Label>
      </Card>
      <SectionTitle>{t('about.backupTitle')}</SectionTitle>
      <Small>{t('backup.contains')}</Small>
      <Small>{t('about.deviceBackup')}</Small>
      <Card>
        <Row testID="about-privacy-link" label={t('about.privacyLink')} onPress={openPrivacy} />
      </Card>
      <Small testID="about-version">{t('about.version', { version: Constants.expoConfig?.version ?? '1.0.0' })}</Small>
    </Screen>
  );
}
