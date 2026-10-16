import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, Chip, Field, Label, Screen, SectionTitle, Small, ToggleRow, Wrap } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { addReminder, ALL_WEEKDAYS, deleteReminder, listReminders, MAX_REMINDERS, updateReminder, type Reminder } from '@/db/reminders';
import { setJournalSetting } from '@/db/settings';
import { formatTime } from '@/engine/dates';
import { useFormatter, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { showError } from '@/lib/errors';
import { formatClock, weekdayName } from '@/lib/locale';
import { openNotificationSettings, reminderStatus, requestPermission, sendTestReminder, sync } from '@/lib/reminders';
import { write } from '@/lib/write';

// Reminders (SPEC Reminders, A8, A13): up to 6, weekdays, skip if logged, own text, test, status line. The permission
// is asked only when a reminder is switched on (A2).
export default function Reminders() {
  const db = useSQLiteContext();
  const { t, locale } = useFormatter();
  const settings = useSettings();
  const reminders = useLoad(() => listReminders(db), []);
  const [tick, setTick] = useState(0);
  const status = useLoad(() => reminderStatus(db), [reminders, tick]);
  // The status line reads the OS list: refresh it after each re-plan has finished.
  const replan = (opts?: { full?: boolean }) => sync(db, opts).then(() => setTick((n) => n + 1));
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);

  const save = async (r: Reminder, patch: Partial<Reminder>) => {
    try {
      const next = { ...r, ...patch };
      if (patch.enabled && !(await requestPermission())) return;
      await write(() => updateReminder(db, r.id, next));
      await replan();
    } catch (e) {
      showError(t, e);
    }
  };

  const pickTime = (r: Reminder) => {
    const value = new Date(Date.UTC(2026, 0, 1, r.hour, r.minute));
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value, mode: 'time', is24Hour: true, timeZoneName: 'UTC', onChange: (e, d) => e.type === 'set' && d && void save(r, { hour: d.getUTCHours(), minute: d.getUTCMinutes() }) });
    } else setEditing(editing === r.id ? null : r.id);
  };

  const permission = status?.permission;
  return (
    <Screen testID="reminders-screen">
      <Stack.Screen options={{ title: t('reminders.title') }} />
      <Small testID="reminder-status">
        {!status
          ? ' '
          : permission?.status === 'granted'
            ? status.next
              ? t('reminders.statusNext', { n: status.scheduled, next: `${status.next.date} ${formatClock(locale, status.next.time)}` })
              : t('reminders.statusNone', { n: status.scheduled })
            : permission?.status === 'denied'
              ? t('reminders.off')
              : t('reminders.notAsked')}
      </Small>
      {permission?.status === 'denied' ? <Button testID="reminder-open-settings" variant="secondary" label={t('reminders.openSettings')} onPress={() => void openNotificationSettings()} /> : null}
      {(reminders ?? []).map((r) => (
        <Card key={r.id} testID={`reminder-${r.id}`}>
          <View style={styles.row}>
            <Chip testID={`reminder-${r.id}-time`} label={formatClock(locale, formatTime(r.hour, r.minute))} onPress={() => pickTime(r)} />
            <View style={styles.flex} />
            <Small>{t('reminders.on')}</Small>
            <Switch testID={`reminder-${r.id}-toggle`} accessibilityLabel={t('reminders.on')} value={r.enabled} onValueChange={(v) => void save(r, { enabled: v })} />
          </View>
          {editing === r.id && Platform.OS === 'ios' ? (
            <DateTimePicker value={new Date(Date.UTC(2026, 0, 1, r.hour, r.minute))} mode="time" display="spinner" timeZoneName="UTC" onChange={(_e, d) => d && void save(r, { hour: d.getUTCHours(), minute: d.getUTCMinutes() })} />
          ) : null}
          <Wrap>
            {[1, 2, 3, 4, 5, 6, 7].map((w) => {
              const bit = 1 << (w - 1);
              const on = (r.weekdays & bit) !== 0;
              return (
                <Chip
                  key={w}
                  testID={`reminder-${r.id}-day-${w}`}
                  label={weekdayName(locale, w, 'short')}
                  selected={on}
                  onPress={() => {
                    const weekdays = on ? r.weekdays & ~bit : r.weekdays | bit;
                    if (weekdays) void save(r, { weekdays });
                  }}
                />
              );
            })}
          </Wrap>
          <Chip testID={`reminder-${r.id}-delete`} label={t('reminders.delete')} onPress={() => void write(() => deleteReminder(db, r.id)).then(() => replan())} />
        </Card>
      ))}
      {(reminders?.length ?? 0) < MAX_REMINDERS ? (
        <Button
          testID="reminder-add"
          label={t('reminders.add')}
          onPress={async () => {
            if (!(await requestPermission())) return;
            try {
              await write(() => addReminder(db, { hour: 20, minute: 0, weekdays: ALL_WEEKDAYS, enabled: true }));
              await replan();
            } catch (e) {
              showError(t, e);
            }
          }}
        />
      ) : (
        <Small>{t('error.tooManyReminders')}</Small>
      )}
      <SectionTitle>{t('reminders.options')}</SectionTitle>
      <Card>
        <ToggleRow
          testID="reminder-skip-logged"
          label={t('reminders.skipLogged')}
          hint={t('reminders.skipLoggedHint')}
          value={settings.reminderSkipIfLogged}
          onChange={(v) => void write(() => setJournalSetting(db, 'reminderSkipIfLogged', v)).then(() => replan())}
        />
        <Field
          testID="reminder-text"
          label={t('reminders.text')}
          placeholder={t('reminder.body')}
          value={text ?? settings.reminderText}
          onChangeText={setText}
          onEndEditing={() => {
            if (text !== null) void write(() => setJournalSetting(db, 'reminderText', text.trim())).then(() => replan({ full: true }));
          }}
          maxLength={120}
        />
        <Small>{t('reminders.textHint')}</Small>
      </Card>
      <Button
        testID="reminder-test"
        variant="secondary"
        label={t('reminders.test')}
        onPress={async () => setTestSent(await sendTestReminder(db, 10))}
      />
      {testSent ? <Label testID="reminder-test-sent">{t('reminders.testSent')}</Label> : null}
      <Small>{t('reminders.deviceNote')}</Small>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
