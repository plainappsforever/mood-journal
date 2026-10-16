// Search in note titles and notes (SPEC Search): case- and diacritics-insensitive ("cafe" finds "Café", "zoe" finds
// "Zoë"). Pure: the screen highlights the returned ranges in the ORIGINAL text.

/** Folded form of one character sequence: NFD, combining marks removed, lower case (locale-free). ß → ss. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss');
}

/**
 * Folded text plus, for every folded character, the index in the original string it came from (so match ranges map
 * back even when folding changes lengths).
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(text.length);
  return { folded, map };
}

export type MatchRange = { start: number; end: number };

/** All non-overlapping matches of `query` in `text` as ranges of the original text; [] when the query is empty. */
export function findMatches(text: string, query: string): MatchRange[] {
  const q = fold(query.trim());
  if (!q) return [];
  const { folded, map } = foldWithMap(text);
  const out: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(q, from);
    if (at < 0) break;
    const end = map[at + q.length] ?? text.length;
    const start = map[at];
    if (!out.length || start >= out[out.length - 1].end) out.push({ start, end: Math.max(end, start + 1) });
    from = at + q.length;
  }
  return out;
}

export function matches(text: string, query: string): boolean {
  const q = fold(query.trim());
  return !q || fold(text).includes(q);
}
