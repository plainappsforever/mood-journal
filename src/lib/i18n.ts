// Minimal translation layer. Strings live in src/i18n/<lang>.ts (same keys, parity test); screens call `useT()`
// (src/hooks/use-t.ts). Pure engines receive a Translator as a parameter and never read the current language.
import { ar } from '@/i18n/ar';
import { de } from '@/i18n/de';
import { en, type MessageKey, type Messages } from '@/i18n/en';
import { es } from '@/i18n/es';
import { fr } from '@/i18n/fr';
import { hi } from '@/i18n/hi';
import { id } from '@/i18n/id';
import { it } from '@/i18n/it';
import { ja } from '@/i18n/ja';
import { ko } from '@/i18n/ko';
import { ptBR } from '@/i18n/pt-BR';
import { ru } from '@/i18n/ru';
import { tr } from '@/i18n/tr';
import { vi } from '@/i18n/vi';
import { zhCN } from '@/i18n/zh-CN';

/** 15 UI languages (A14, D11). Extra plural keys (`_zero`, `_two`, `_few`, `_many`) are allowed where CLDR needs them. */
export const messages = { en, de, ar, es, fr, hi, id, it, ja, ko, 'pt-BR': ptBR, ru, tr, vi, 'zh-CN': zhCN } satisfies Record<string, Messages>;

export type Language = keyof typeof messages;
/** Right-to-left UI languages. */
export const RTL_LANGUAGES: readonly Language[] = ['ar'];
export type { MessageKey };
export type Params = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: Params) => string;

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGES = Object.keys(messages) as Language[];

let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  listeners.forEach((l) => l());
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Best supported language for BCP-47 tags in preference order (e.g. expo-localization's list); English otherwise. */
export function pickLanguage(tags: readonly string[]): Language {
  for (const tag of tags) {
    const parts = tag.toLowerCase().split(/[-_]/);
    const base = parts[0] === 'in' ? 'id' : parts[0]; // old Java code for Indonesian
    if (base === 'pt') return 'pt-BR'; // one Portuguese, written for Brazil (D11)
    if (base === 'zh') {
      // Simplified Chinese only; a Traditional Chinese phone (Hant / TW / HK / MO) goes on to its next language.
      if (parts.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo')) continue;
      return 'zh-CN';
    }
    if ((LANGUAGES as string[]).includes(base)) return base as Language;
  }
  return DEFAULT_LANGUAGE;
}

export function translate(language: Language, key: MessageKey, params?: Params): string {
  const text: string = (messages[language] as Messages)[key] ?? messages[DEFAULT_LANGUAGE][key];
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

const pluralRules = new Map<Language, Intl.PluralRules | null>();

/** CLDR plural category of n in `language` (Intl.PluralRules; 'one'/'other' if Intl lacks it). */
export function pluralCategory(language: Language, n: number): string {
  let rules = pluralRules.get(language);
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(language);
    } catch {
      rules = null;
    }
    pluralRules.set(language, rules);
  }
  return rules ? rules.select(n) : n === 1 ? 'one' : 'other';
}

/** `base` + `_<category>` (falling back to `_other`), with {n} filled in. Example: plural('en', 'count.days', 3). */
export function translatePlural(language: Language, base: string, n: number, params?: Params): string {
  const own = `${base}_${pluralCategory(language, n)}` as MessageKey;
  const key = (own in (messages[language] as Record<string, string>) ? own : `${base}_other`) as MessageKey;
  return translate(language, key, { n, ...params });
}

const translators = new Map<Language, Translator>();

/** One translator per language: same identity for the same language, a different function for another one. */
export function makeT(language: Language): Translator {
  let t = translators.get(language);
  if (!t) {
    t = (key, params) => translate(language, key, params);
    translators.set(language, t);
  }
  return t;
}
