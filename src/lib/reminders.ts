// Reminder glue (SPEC Reminders, D21, D35, D42): the database is the truth; `sync()` rebuilds the OS pending list from
// the pure plan (src/engine/reminder-plan.ts) on start, on return to the foreground (also catches zone changes),
// and after every journal change (an entry made today cancels today's reminder with "skip if logged").
// Permission: only when the user turns a reminder on (SPEC Principles, A2).
import * as Notifications from 'expo-notifications';
import { AppState, Linking, Platform } from 'react-native';

import { entryCreationTimes } from '@/db/entries';
import { listReminders } from '@/db/reminders';
import { getJournalSettings } from '@/db/settings';
import type { Db } from '@/db/types';
import { ID_PREFIX, planReminders, type PlannedReminder } from '@/engine/reminder-plan';
import { now, offsetAt, today } from '@/lib/clock';
import { getLanguage, translate } from '@/lib/i18n';
import { subscribeJournal } from '@/lib/journal-store';

export const CHANNEL_ID = 'reminders';
const TEST_ID = 'mood-test';
const DEBOUNCE_MS = 400;

export type PermissionState = { status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean };

function isGranted(p: Notifications.NotificationPermissionsStatus): boolean {
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function getPermissionState(): Promise<PermissionState> {
  const p = await Notifications.getPermissionsAsync();
  return { status: isGranted(p) ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined', canAskAgain: p.canAskAgain };
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: translate(getLanguage(), 'reminder.channel'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** System prompt (or, when the phone will not ask again, this app's settings page). True when granted. */
export async function requestPermission(): Promise<boolean> {
  await ensureChannel(); // Android 13+: the prompt only appears once a channel exists
  const before = await getPermissionState();
  if (before.status === 'granted') return true;
  if (!before.canAskAgain) {
    await Linking.openSettings();
    return false;
  }
  return isGranted(await Notifications.requestPermissionsAsync());
}

export function openNotificationSettings(): Promise<void> {
  return Linking.openSettings();
}

/** The plan for now from the database (text = the user's own or "How was your day?", never journal content, A13). */
export async function buildPlan(db: Db): Promise<PlannedReminder[]> {
  const [reminders, settings] = await Promise.all([listReminders(db), getJournalSettings(db)]);
  const journalDay = today(settings.dayEndHour);
  const made = await entryCreationTimes(db, journalDay);
  const language = getLanguage();
  const plan = planReminders({
    reminders,
    nowMs: now(),
    offsetAt: offsetAt(),
    dayEndHour: settings.dayEndHour,
    skipIfLogged: settings.reminderSkipIfLogged,
    entriesMadeOn: (d) => (d === journalDay ? made : []),
    title: translate(language, 'reminder.title'),
    body: settings.reminderText.trim() || translate(language, 'reminder.body'),
  });
  return plan.scheduled;
}

export type SyncResult = { permission: PermissionState['status']; planned: number; scheduled: number };

async function syncOnce(db: Db, full: boolean): Promise<SyncResult> {
  const permission = (await getPermissionState()).status;
  const planned = permission === 'granted' ? await buildPlan(db) : [];
  const existing = (await Notifications.getAllScheduledNotificationsAsync()).filter((r) => r.identifier.startsWith(ID_PREFIX));
  const wanted = new Set(planned.map((p) => p.identifier));
  const have = new Set(existing.map((r) => r.identifier));
  for (const r of existing) if (!wanted.has(r.identifier)) await Notifications.cancelScheduledNotificationAsync(r.identifier);
  if (planned.length > 0) await ensureChannel();
  for (const p of planned) {
    // Full rebuild on start: re-arm every alarm (after a force stop Android drops alarms but still lists them; WW).
    if (!full && have.has(p.identifier)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: p.identifier,
      content: { title: p.title, body: p.body, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.utcMs, channelId: CHANNEL_ID },
    });
  }
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((r) => r.identifier.startsWith(ID_PREFIX)).length;
  return { permission, planned: planned.length, scheduled };
}

let running: Promise<SyncResult> | null = null;
let pending: { full: boolean } | null = null;

/** One sync at a time; a request during a run schedules exactly one more run afterwards. */
export function sync(db: Db, options: { full?: boolean } = {}): Promise<SyncResult> {
  if (running) {
    pending = { full: (pending?.full ?? false) || !!options.full };
    return running.then(() => (running ? running : sync(db)));
  }
  running = (async () => {
    try {
      return await syncOnce(db, !!options.full);
    } finally {
      running = null;
      const next = pending;
      pending = null;
      if (next) void sync(db, next);
    }
  })();
  return running;
}

let appDb: Db | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function requestSync(): void {
  if (!appDb) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (appDb) sync(appDb).catch((e) => console.warn('reminder sync failed', e));
  }, DEBOUNCE_MS);
}

/** App start: full rebuild, then on every foreground and after every journal change. */
export function startReminders(db: Db): void {
  if (appDb) return;
  appDb = db;
  sync(db, { full: true }).catch((e) => console.warn('reminder sync failed', e));
  AppState.addEventListener('change', (state) => {
    if (state === 'active') requestSync();
  });
  subscribeJournal(requestSync);
}

export type ReminderStatus = { permission: PermissionState; scheduled: number; next: PlannedReminder | null };

/** Status line on the Reminders screen: permission, how many the OS holds, the next one. */
export async function reminderStatus(db: Db): Promise<ReminderStatus> {
  const [permission, all] = await Promise.all([getPermissionState(), Notifications.getAllScheduledNotificationsAsync()]);
  const ours = new Set(all.map((r) => r.identifier).filter((id) => id.startsWith(ID_PREFIX)));
  const planned = permission.status === 'granted' ? await buildPlan(db) : [];
  return { permission, scheduled: ours.size, next: planned.find((p) => ours.has(p.identifier)) ?? null };
}

/** "Test reminder" (10 s) and the dev link `debug/reminder-in?s=120`: same text as a real reminder. */
export async function sendTestReminder(db: Db, seconds: number): Promise<boolean> {
  if (!(await requestPermission())) return false;
  await ensureChannel();
  const settings = await getJournalSettings(db);
  const language = getLanguage();
  await Notifications.scheduleNotificationAsync({
    identifier: `${TEST_ID}-${seconds}`,
    content: { title: translate(language, 'reminder.title'), body: settings.reminderText.trim() || translate(language, 'reminder.body'), sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: CHANNEL_ID },
  });
  return true;
}
