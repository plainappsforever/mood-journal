// Key, placeholder and plural parity across every locale (A14, P10).
import { messages, pickLanguage, type Language } from '@/lib/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const EXTRA_PLURAL = /^(.*)_(zero|two|few|many)$/;
const en = messages.en as Record<string, string>;
const pluralBases = Object.keys(en).filter((k) => k.endsWith('_other')).map((k) => k.slice(0, -'_other'.length));

describe('locale parity', () => {
  const enKeys = Object.keys(en).sort();
  for (const [lang, table] of Object.entries(messages) as [Language, Record<string, string>][]) {
    it(`${lang} has every English key; extra keys are only CLDR plural forms of English plural keys`, () => {
      const own = Object.keys(table);
      expect(enKeys.filter((k) => !(k in table))).toEqual([]);
      const extra = own.filter((k) => !(k in en));
      for (const k of extra) {
        const m = EXTRA_PLURAL.exec(k);
        expect({ k, ok: !!m && pluralBases.includes(m[1]) }).toEqual({ k, ok: true });
      }
    });
    it(`${lang} keeps every placeholder and has no empty string`, () => {
      for (const key of Object.keys(table)) {
        const value = table[key];
        const m = EXTRA_PLURAL.exec(key);
        const source = key in en ? en[key] : en[`${m![1]}_other`];
        expect({ key, value: value.trim().length > 0 }).toEqual({ key, value: true });
        expect({ key, p: placeholders(value) }).toEqual({ key, p: placeholders(source) });
      }
    });
    it(`${lang} has a form for every plural category its counts 0–1000 use`, () => {
      const rules = new Intl.PluralRules(lang);
      const used = new Set<string>();
      for (let n = 0; n <= 1000; n++) used.add(rules.select(n));
      for (const base of pluralBases) for (const c of used) expect({ base, c, ok: `${base}_${c}` in table }).toEqual({ base, c, ok: true });
    });
  }
  it('15 languages', () => expect(Object.keys(messages)).toHaveLength(15));
});

describe('pickLanguage', () => {
  it.each([
    [['de-AT'], 'de'],
    [['pt-PT'], 'pt-BR'],
    [['pt-BR'], 'pt-BR'],
    [['zh-Hans-CN'], 'zh-CN'],
    [['zh-CN'], 'zh-CN'],
    [['zh-Hant-TW', 'ja-JP'], 'ja'],
    [['zh-TW'], 'en'],
    [['in-ID'], 'id'],
    [['ar-EG'], 'ar'],
    [['nl-NL', 'fr-BE'], 'fr'],
    [['sv-SE'], 'en'],
  ] as [string[], Language][])('%j → %s', (tags, lang) => expect(pickLanguage(tags)).toBe(lang));
});
