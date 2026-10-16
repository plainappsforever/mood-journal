// RELEASE_KIT Appendix C (P11, A15 "and store text"): every ```store <lang> <limit> block of docs/RELEASE_KIT.md fits its
// store limit (⟨Name⟩ counted as the longest name option, "Mood Notebook") and has no banned medical word outside the
// mandated disclaimer paragraph (the same exemption the app's `about.disclaimer` has).
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { findBannedWords } from './wording';

// The public source export leaves docs/RELEASE_KIT.md out (internal release notes): then there is nothing to check.
const KIT_PATH = join(__dirname, '../../docs/RELEASE_KIT.md');
const kit = existsSync(KIT_PATH) ? readFileSync(KIT_PATH, 'utf8') : '';
const blocks = [...kit.matchAll(/```store (\w+(?:-\w+)?) (\d+)\n([\s\S]*?)\n```/g)].map((m, i) => ({
  i,
  lang: m[1],
  limit: Number(m[2]),
  text: m[3].replaceAll('⟨Name⟩', 'Mood Notebook'),
}));
const DISCLAIMER = /not a medical device|kein Medizinprodukt/;

(kit ? describe : describe.skip)('store texts in docs/RELEASE_KIT.md', () => {
  it('has the EN and DE listings for both stores', () => {
    expect(blocks.filter((b) => b.lang === 'en')).toHaveLength(8);
    expect(blocks.filter((b) => b.lang === 'de')).toHaveLength(8);
  });

  it.each(blocks.map((b) => [b.i, b.lang, b.limit, b] as const))('block %i (%s, ≤ %i characters) fits and uses no banned word', (_i, lang, limit, b) => {
    expect([...b.text].length).toBeLessThanOrEqual(limit);
    const scanned = b.text
      .split('\n')
      .filter((line) => !DISCLAIMER.test(line))
      .join('\n');
    expect(findBannedWords(lang, { [`store-${b.i}`]: scanned })).toEqual([]);
  });

  it('every full description carries the disclaimer and the healthcare-professional reminder (Play health policy)', () => {
    const full = blocks.filter((b) => b.limit === 4000);
    expect(full).toHaveLength(4);
    for (const b of full) {
      expect(b.text).toMatch(DISCLAIMER);
      expect(b.text).toMatch(/healthcare professional|Fachpersonal/);
    }
  });
});
