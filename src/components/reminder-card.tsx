import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, Label } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { addReminder, ALL_WEEKDAYS, listReminders } from '@/db/reminders';
import { getSetting, setSetting } from '@/db/settings';
import { useLoad } from '@/hooks/use-load';
import { useT } from '@/hooks/use-t';
import { requestPermission, sync } from '@/lib/reminders';
import { write } from '@/lib/write';

const CARD_KEY = 'reminder_card_done';

/** SPEC flow 1: after the first entry, one quiet card — the permission is asked only on "Turn on". */
export function ReminderCard({ hasEntries }: { hasEntries: boolean }) {
  const db = useSQLiteContext();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const show = useLoad(async () => !(await getSetting(db, CARD_KEY)) && (await listReminders(db)).length === 0, []);
  if (!hasEntries || !show) return null;
  const done = () => write(() => setSetting(db, CARD_KEY, '1'));
  return (
    <Card testID="reminder-card">
      <Label>{t('reminder.card.text')}</Label>
      <View style={styles.row}>
        <Button
          testID="reminder-card-on"
          label={t('reminder.card.on')}
          disabled={busy}
          style={styles.flex}
          onPress={async () => {
            setBusy(true);
            try {
              if (await requestPermission()) {
                await write(() => addReminder(db, { hour: 20, minute: 0, weekdays: ALL_WEEKDAYS, enabled: true }));
                await sync(db);
              }
            } finally {
              await done();
              setBusy(false);
            }
          }}
        />
        <Button testID="reminder-card-later" variant="secondary" label={t('reminder.card.later')} style={styles.flex} onPress={() => void done()} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
