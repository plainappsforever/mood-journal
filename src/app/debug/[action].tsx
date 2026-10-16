import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Label, Screen } from '@/components/ui';
import { resetJournal, seedJournal } from '@/db/dev';
import { useSQLiteContext } from '@/db/provider';
import { getJournalSettings, setJournalSetting } from '@/db/settings';
import { localToUtc } from '@/engine/dates';
import { useLanguage } from '@/hooks/use-t';
import { calendarToday, now, offsetAt, pinClock, today } from '@/lib/clock';
import { journalChanged } from '@/lib/journal-store';
import { requestLockRecheck } from '@/lib/lock-controller';
import { sendTestReminder, sync } from '@/lib/reminders';
import { runDevAction } from '@/lib/dev-actions';

// Dev builds only (`__DEV__`): `<scheme>://debug/reset`, `debug/seed?days=365&perDay=3`, `debug/clock?at=2026-10-16T01:30`,
// `debug/reminder-in?s=120`, plus the P8 helpers in src/lib/dev-actions.ts. Add `&stay=1` to keep this screen open.
export default function Debug() {
  const params = useLocalSearchParams<Record<string, string>>();
  const db = useSQLiteContext();
  const language = useLanguage();
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!__DEV__) {
      router.replace('/');
      return;
    }
    let active = true;
    (async () => {
      const started = Date.now();
      const { action } = params;
      let text = '';
      if (action === 'reset') {
        await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
        pinClock(null);
        await resetJournal(db, language, Date.now());
        requestLockRecheck(); // the lock setting is gone with the reset: drop a cover that is up
        await sync(db).catch(() => undefined);
        text = 'reset';
      } else if (action === 'unlock') {
        // Dev: switch the app lock off and drop the cover (flows start from an unlocked app)
        await setJournalSetting(db, 'lockEnabled', false);
        requestLockRecheck();
        text = 'unlocked';
      } else if (action === 'seed') {
        const settings = await getJournalSettings(db);
        const end = today(settings.dayEndHour);
        const n = await seedJournal(db, {
          days: Number(params.days ?? 365),
          perDay: Number(params.perDay ?? 3),
          end,
          seed: params.seed ? Number(params.seed) : undefined,
          offsetMin: offsetAt()(now()),
          now: now(),
        });
        text = `seeded ${n}`;
      } else if (action === 'clock') {
        if (params.at) {
          // `at=2026-10-16T01:30`, or `at=01:30` = today (calendar date) at that wall time
          const [date, time] = params.at.includes('T') ? params.at.split('T') : [calendarToday(), params.at];
          pinClock(localToUtc(date, time, offsetAt()));
        } else {
          pinClock(null);
        }
        text = `clock ${params.at ?? 'real'}`;
      } else if (action === 'reminder-in') {
        const ok = await sendTestReminder(db, Number(params.s ?? 120));
        text = ok ? `reminder in ${params.s ?? 120} s` : 'notifications off';
      } else {
        text = await runDevAction(db, action, params);
      }
      journalChanged();
      const ms = Date.now() - started;
      console.log(`[debug] ${action}: ${text} (${ms} ms)`);
      if (!active) return;
      setResult(`${text} · ${ms} ms`);
      if (!params.stay) router.replace('/entries');
    })().catch((e) => {
      console.warn('debug action failed', e);
      if (active) setResult(`failed: ${String(e)}`);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen testID="debug-screen">
      <Label testID={result ? 'debug-done' : 'debug-running'}>{result ?? '…'}</Label>
    </Screen>
  );
}
