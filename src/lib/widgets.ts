// Pushes what the widgets show (SPEC flow 10, A11, D20): iOS = expo-widgets timeline (src/widgets/mood-widget.tsx,
// loaded lazily and only in builds that carry the extension), Android = the RemoteViews widget in modules/mood-widget.
// Re-pushed on start, on every foreground and after every journal change (debounced). Never throws.
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import MoodWidgetNative from '../../modules/mood-widget/src/MoodWidgetModule';
import { listEntries, loggedDates } from '@/db/entries';
import { listMoods } from '@/db/moods';
import { getJournalSettings } from '@/db/settings';
import type { Db } from '@/db/types';
import { roundHalfUp } from '@/engine/stats/types';
import { computeStreak } from '@/engine/streaks';
import { now, offsetAt, today } from '@/lib/clock';
import { getLanguage, translate, translatePlural } from '@/lib/i18n';
import { subscribeJournal } from '@/lib/journal-store';
import { widgetTimeline, type WidgetFacts, type WidgetWords } from '@/lib/widget-data';

type Layouts = typeof import('@/widgets/mood-widget');
let layouts: Layouts | null | undefined;

function iosLayouts(): Layouts | null {
  if (layouts !== undefined) return layouts;
  if (Platform.OS !== 'ios' || Constants.expoConfig?.extra?.widgetsEnabled !== true || !requireOptionalNativeModule('ExpoWidgets')) return (layouts = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    layouts = require('@/widgets/mood-widget') as Layouts;
  } catch (e) {
    console.warn('[widgets] unavailable', e);
    layouts = null;
  }
  return layouts;
}

const scheme = () => String(Constants.expoConfig?.scheme ?? 'moodjournal');

export async function widgetFacts(db: Db): Promise<WidgetFacts> {
  const settings = await getJournalSettings(db);
  const day = today(settings.dayEndHour);
  const [moods, entriesToday, dates] = await Promise.all([listMoods(db), listEntries(db, { from: day, to: day }), loggedDates(db)]);
  const first = new Map<number, (typeof moods)[number]>();
  for (const m of moods) if (!m.archived && !first.has(m.level)) first.set(m.level, m);
  const faces = [5, 4, 3, 2, 1].flatMap((level) => {
    const m = first.get(level);
    return m ? [{ level, emoji: m.emoji, color: m.color, name: m.name }] : [];
  });
  const mean = entriesToday.length ? entriesToday.reduce((s, e) => s + e.level, 0) / entriesToday.length : null;
  const todayColor = mean === null ? null : (first.get(Math.min(5, Math.max(1, roundHalfUp(mean))))?.color ?? null); // Formula 7
  return { scheme: scheme(), locked: settings.lockEnabled, faces, today: day, todayColor, streak: computeStreak(dates, day).current, loggedToday: entriesToday.length > 0, dayEndHour: settings.dayEndHour };
}

export function widgetWords(): WidgetWords {
  const lang = getLanguage(); // not during render: glue only
  return {
    title: translate(lang, 'widget.title'),
    locked: translate(lang, 'app.name'),
    log: translate(lang, 'widget.log'),
    notYet: translate(lang, 'widget.notYet'),
    loggedToday: translate(lang, 'widget.loggedToday'),
    streak: (n) => translate(lang, 'widget.streak', { days: translatePlural(lang, 'count.days', n) }),
    noStreak: translate(lang, 'widget.noStreak'),
  };
}

/** Build + push once. */
export async function pushWidgets(db: Db): Promise<void> {
  const ios = iosLayouts();
  if (!ios && !MoodWidgetNative) return;
  const facts = await widgetFacts(db);
  const timeline = widgetTimeline(facts, widgetWords(), now(), offsetAt());
  if (ios) {
    // The native side takes plain JSON values; a null inside props made updateTimeline throw (HostFunction), so null
    // fields are left out (the layout reads them as undefined).
    const clean = (p: object) => JSON.parse(JSON.stringify(p, (_k, v) => (v === null ? undefined : v))) as typeof timeline[number]['props'];
    try {
      ios.MoodWidget.updateTimeline(timeline.map((e) => ({ date: new Date(e.date), props: clean(e.props) })));
    } catch (e) {
      console.warn('[widgets] ios timeline', e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : e);
    }
  }
  if (MoodWidgetNative) {
    const states = timeline.map((e) => ({
      fromMs: e.date,
      status: e.props.locked ? e.props.title : [e.props.todayText, e.props.streakText].filter(Boolean).join(' · '),
      todayColor: e.props.todayColor,
      description: e.props.locked ? e.props.title : `${e.props.todayText}. ${e.props.streakText}`,
    }));
    MoodWidgetNative.setData(JSON.stringify({ scheme: facts.scheme, locked: facts.locked, faces: facts.faces, states }));
  }
}

let appDb: Db | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<void> = Promise.resolve();

export function requestWidgetSync(): void {
  if (!appDb) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const db = appDb;
    if (db) queue = queue.then(() => pushWidgets(db)).catch((e) => console.warn(`[widgets] push failed: ${String(e)} :: ${e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 8).join(' | ') : ''}`));
  }, 400);
}

/** App start: push now, then on every foreground and journal change. */
export function startWidgets(db: Db): void {
  if (appDb) return;
  appDb = db;
  requestWidgetSync();
  AppState.addEventListener('change', (state) => {
    if (state === 'active' || state === 'background') requestWidgetSync();
  });
  subscribeJournal(requestWidgetSync);
}

/** Android "Add widget" (launcher dialog); null on iOS. */
export function requestPinWidget(): 'requested' | 'alreadyAdded' | 'unsupported' | null {
  return MoodWidgetNative ? MoodWidgetNative.requestPinWidget() : null;
}

export function androidWidgetCount(): number {
  return MoodWidgetNative ? MoodWidgetNative.widgetCount() : 0;
}
