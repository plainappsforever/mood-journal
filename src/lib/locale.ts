// UI language follows the device (SPEC Appearance: "language follows device"). Dates, weekdays and numbers via Intl
// with an explicit UTC zone on date strings, so a date string never shifts with the device zone.
import { getLocales } from 'expo-localization';

import { addDays, dayNumber, type DateStr } from '@/engine/dates';
import * as SecureStore from 'expo-secure-store';
import { I18nManager, Platform } from 'react-native';

import BackupFolder from '../../modules/backup-folder/src/BackupFolderModule';
import { pickLanguage, RTL_LANGUAGES, setLanguage, type Language, type Translator } from '@/lib/i18n';

export function deviceLanguage(): Language {
  try {
    return pickLanguage(getLocales().map((l) => l.languageTag));
  } catch {
    return 'en';
  }
}

export function initLanguage(): Language {
  const language = deviceLanguage();
  setLanguage(language);
  return language;
}

/** BCP-47 tag for Intl: the device tag when it is in the UI language (en-GB, de-AT …), else the language. */
export function localeTag(language: Language): string {
  try {
    const tag = getLocales().find((l) => l.languageTag.toLowerCase().startsWith(language))?.languageTag;
    return tag ?? language;
  } catch {
    return language;
  }
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    cache.set(key, f);
  }
  return f;
}

const utcDate = (d: DateStr) => new Date(dayNumber(d) * 86_400_000);

/** "Friday, 16 October" (+ year when not this year). */
export function formatDayLong(locale: string, date: DateStr, today: DateStr): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return fmt(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }).format(utcDate(date));
}

/** "16 Oct 2026". */
export function formatDayShort(locale: string, date: DateStr): string {
  return fmt(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(utcDate(date));
}

/** "Today" / "Yesterday" / "Fri, 16 Oct". */
export function formatDayRelative(t: Translator, locale: string, date: DateStr, today: DateStr): string {
  if (date === today) return t('day.today');
  if (date === addDays(today, -1)) return t('day.yesterday');
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return fmt(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(utcDate(date));
}

/** "October 2026". */
export function formatMonthYear(locale: string, year: number, month: number): string {
  return fmt(locale, { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** "Oct". */
export function formatMonthShort(locale: string, month: number): string {
  return fmt(locale, { month: 'short' }).format(new Date(Date.UTC(2026, month - 1, 1)));
}

/** Weekday names from ISO weekday 1 (Monday) … 7, short ("Mon") or narrow ("M"). */
export function weekdayName(locale: string, isoWeekday: number, style: 'short' | 'narrow' | 'long' = 'short'): string {
  // 2026-10-12 is a Monday.
  return fmt(locale, { weekday: style }).format(new Date(Date.UTC(2026, 9, 11 + isoWeekday)));
}

/** "20:00" or "8:00 PM" by the locale. */
export function formatClock(locale: string, time: string): string {
  const [h, m] = time.split(':').map(Number);
  return fmt(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2026, 0, 1, h, m)));
}

/**
 * Android only (P10): React Native's own check for an RTL phone language does not see the app's language (it reads
 * Locale.getAvailableLocales()[0]; measured: Arabic UI, isRTL false, both for the phone language and the per-app
 * language). So the direction is forced to match the UI language and the app restarts once to apply it. iOS mirrors by
 * itself (CFBundleLocalizations declares Arabic). A guard in secure storage stops a restart loop.
 */
export function syncLayoutDirection(language: Language): void {
  if (Platform.OS !== 'android') return;
  const want = RTL_LANGUAGES.includes(language);
  if (I18nManager.isRTL === want) return;
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(want);
  const key = 'mood.layoutRestartFor';
  const target = want ? 'rtl' : 'ltr';
  try {
    if (SecureStore.getItem(key) === target) return; // already restarted once for this direction
    SecureStore.setItem(key, target);
  } catch {
    return;
  }
  setTimeout(() => BackupFolder.restartApp?.(), 600); // let the preference write land first
}
