import { findMatches, matches } from './search';

describe('search (diacritics- and case-insensitive)', () => {
  it('finds Café with "cafe" and Zoë with "ZOE", ranges in the original text', () => {
    const text = 'Café with Zoë';
    expect(matches(text, 'cafe')).toBe(true);
    expect(findMatches(text, 'cafe')).toEqual([{ start: 0, end: 4 }]);
    expect(findMatches(text, 'ZOE')).toEqual([{ start: 10, end: 13 }]);
    expect(text.slice(10, 13)).toBe('Zoë');
  });
  it('keeps decomposed input, ß and emoji aligned', () => {
    const text = 'Spaß 🎉 café Straße';
    expect(findMatches(text, 'spass').map((r) => text.slice(r.start, r.end))).toEqual(['Spaß']);
    expect(findMatches(text, 'café').map((r) => text.slice(r.start, r.end))).toEqual(['café']);
    expect(findMatches(text, 'strasse').map((r) => text.slice(r.start, r.end))).toEqual(['Straße']);
  });
  it('empty query matches everything and returns no ranges; repeated matches', () => {
    expect(matches('x', '  ')).toBe(true);
    expect(findMatches('x', '')).toEqual([]);
    expect(findMatches('aaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(matches('Long walk', 'run')).toBe(false);
  });
});
