import { Stack } from 'expo-router';

import { Card, Chip, Label, Screen, SectionTitle, Small, ToggleRow, Wrap } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { setJournalSetting } from '@/db/settings';
import { useFormatter, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { lockUnavailableReason } from '@/lib/app-lock';
import { confirmOwner, getLockCapability } from '@/lib/local-auth';
import { requestLockRecheck, withLockSuspended } from '@/lib/lock-controller';
import { write } from '@/lib/write';

const AFTER = [0, 60, 300, 900];

// Lock (SPEC Lock, A10): Face ID / fingerprint / device passcode; never locks the owner out. Asked only when switched on.
export default function LockSettings() {
  const db = useSQLiteContext();
  const { t } = useFormatter();
  const settings = useSettings();
  const capability = useLoad(() => getLockCapability(), []);
  const reason = capability ? lockUnavailableReason(capability) : null;
  return (
    <Screen testID="lock-settings">
      <Stack.Screen options={{ title: t('lock.title') }} />
      <Card>
        <ToggleRow
          testID="lock-toggle"
          label={t('lock.toggle')}
          value={settings.lockEnabled}
          disabled={!capability || (reason !== null && !settings.lockEnabled)}
          hint={reason ? t('lock.noPasscode') : t('lock.hint')}
          onChange={async (on) => {
            // Turning it on proves the owner can unlock first (no lock-out); turning off needs no prompt.
            if (on && !(await withLockSuspended(() => confirmOwner(t('lock.prompt'), t('common.cancel'))))) return;
            await write(() => setJournalSetting(db, 'lockEnabled', on));
            requestLockRecheck();
          }}
        />
      </Card>
      <SectionTitle>{t('lock.after')}</SectionTitle>
      <Wrap>
        {AFTER.map((s) => (
          <Chip
            key={s}
            testID={`lock-after-${s}`}
            label={s === 0 ? t('lock.after.now') : t('lock.after.min', { n: s / 60 })}
            selected={settings.lockAfterS === s}
            onPress={() => void write(() => setJournalSetting(db, 'lockAfterS', s))}
          />
        ))}
      </Wrap>
      <Label muted>{t('lock.cover')}</Label>
      <Small>{t('lock.widgetNote')}</Small>
    </Screen>
  );
}
