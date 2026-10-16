import { messages } from '@/lib/i18n';

import { EXEMPT_KEYS, findBannedWords } from './wording';

describe('wording (A15, D23)', () => {
  it.each(Object.keys(messages))('%s has no banned medical words', (lang) => {
    expect(findBannedWords(lang, messages[lang as keyof typeof messages])).toEqual([]);
  });

  it('catches banned words and lets emotion words through', () => {
    const hits = findBannedWords('en', {
      a: 'This therapy helps',
      b: 'Track your depression score',
      c: 'anxious',
      d: 'Your data is secure', // "cure" inside a word is fine
      e: 'Mood improves your mental health',
    });
    expect(hits.map((h) => h.key)).toEqual(['a', 'b', 'e']);
    expect(findBannedWords('de', { x: 'Behandlung', y: 'ängstlich', z: 'Therapie' }).map((h) => h.key)).toEqual(['x', 'z']);
  });

  it('only the mandated disclaimer is exempt, and it says what the app does not do', () => {
    expect(EXEMPT_KEYS).toEqual(['about.disclaimer']);
    expect(messages.en['about.disclaimer']).toContain('not a medical device');
    expect(messages.de['about.disclaimer']).toContain('kein Medizinprodukt');
  });
});
