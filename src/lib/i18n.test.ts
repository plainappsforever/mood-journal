import { getLanguage, makeT, pickLanguage, pluralCategory, setLanguage, subscribeLanguage, translate, translatePlural } from './i18n';

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('returns a different translator function per language (React Compiler memoises on identity)', () => {
    const en = makeT('en');
    const de = makeT('de');
    expect(de).not.toBe(en);
    expect(makeT('en')).toBe(en);
    expect(en('reminder.body')).toBe('How was your day?');
    expect(de('reminder.body')).toBe('Wie war dein Tag?');
  });

  it('switching the language notifies subscribers and yields a new translator', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLanguage(() => seen.push(makeT(getLanguage())('default.mood.5')));
    const before = makeT(getLanguage());
    setLanguage('de');
    setLanguage('de'); // no change, no notification
    unsubscribe();
    setLanguage('en');
    expect(seen).toEqual(['Super']);
    expect(makeT('de')).not.toBe(before);
  });

  it('interpolates params and plurals', () => {
    expect(translate('de', 'goal.progress.week', { activity: 'Sport', count: 1, target: 3 })).toBe('Sport: 1 von 3 diese Woche');
    expect(translatePlural('en', 'count.days', 1)).toBe('1 day');
    expect(translatePlural('en', 'count.days', 0)).toBe('0 days');
    expect(translatePlural('de', 'count.entries', 2)).toBe('2 Einträge');
    expect(pluralCategory('en', 1)).toBe('one');
  });

  it('picks the first supported device language', () => {
    expect(pickLanguage(['sv-SE', 'de-AT', 'en-US'])).toBe('de'); // first SUPPORTED preference (P10: fr and ja are supported now)
    expect(pickLanguage(['sv-SE'])).toBe('en');
  });
});

describe('plural forms of the P10 languages', () => {
  it('Russian one / few / many', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => translatePlural('ru', 'count.days', n))).toEqual(['1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня', '25 дней']);
  });
  it('Arabic six categories', () => {
    expect([0, 1, 2, 3, 11, 100].map((n) => translatePlural('ar', 'count.days', n))).toEqual(['0 يوم', '1 يوم', '2 يوم', '3 أيام', '11 يومًا', '100 يوم']);
  });
  it('languages without plurals use _other', () => {
    expect(translatePlural('ja', 'count.days', 1)).toBe('1日');
    expect(translatePlural('zh-CN', 'count.entries', 3)).toBe('3 条记录');
  });
});
