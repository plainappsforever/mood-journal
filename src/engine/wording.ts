// Wording rules (SPEC "Honest promises", D23, L26): a wellness journal never speaks like a medical product.
// `findBannedWords` is run by Jest over every locale file (and later the store text). The mandated disclaimer is the
// one place that must name what the app does NOT do ("does not diagnose, treat, cure …"), so it is exempt by key.
// The Feelings group's emotion words (anxious, sad …) are the user's own labels and allowed.

export const EXEMPT_KEYS: readonly string[] = ['about.disclaimer'];

const PATTERNS: Record<string, RegExp[]> = {
  en: [
    /\bdiagnos(e|es|ed|is|ing|tic)\b/i,
    /\btherap(y|ies|ist|ists|eutic)\b/i,
    /\btreat(ment|ments|s|ed|ing)?\b/i,
    /\bcur(e|es|ed|ing)\b/i,
    /\bdisorders?\b/i,
    /\b(depression|anxiety) scores?\b/i,
    /\bimproves? your mental health\b/i,
    /\bcrisis\b/i,
    /\bclinical(ly)?\b/i,
    /\bsymptoms?\b/i,
  ],
  de: [
    /\bdiagnos(e|en|tik|tizier\w*)\b/i,
    /\btherap(ie|ien|eut|eutin|eutisch\w*)\b/i,
    /\bbehandl\w*\b/i,
    /\bheil(t|en|ung|ung\w*)\b/i,
    /\bstörung(en)?\b/i,
    /\b(depressions|angst)(wert|score)\w*\b/i,
    /\bverbessert (deine|ihre) psychische gesundheit\b/i,
    /\bkrise\w*\b/i,
    /\bklinisch\w*\b/i,
    /\bsymptom\w*\b/i,
  ],
  // P10 (A15): the same families in the other 13 languages. Latin scripts with word boundaries; other scripts as
  // plain substrings (JS \b only knows ASCII word characters).
  es: [/\bdiagn[oó]stic\w*/i, /\bdiagnostica\w*/i, /\bterap(ia|ias|euta|éutic\w*)\b/i, /\btratamiento\w*/i, /\btrata(r|n)?\b/i, /\bcura(r|n)?\b/i, /\btrastorno\w*/i, /\bcl[ií]nic\w*/i, /\bs[ií]ntoma\w*/i, /\bcrisis\b/i],
  fr: [/\bdiagnos\w*/i, /\bth[ée]rap\w*/i, /\btraitement\w*/i, /\btrait(e|er|ent)\b/i, /\bgu[ée]ri\w*/i, /\btroubles?\b/i, /\bclinique\w*/i, /\bsympt[ôo]me\w*/i, /\bcrise\w*/i],
  it: [/\bdiagnos\w*/i, /\bterap\w*/i, /\btrattament\w*/i, /\btratta(re)?\b/i, /\bcura(re)?\b/i, /\bdisturb\w*/i, /\bclinic\w*/i, /\bsintom\w*/i, /\bcrisi\b/i],
  'pt-BR': [/\bdiagn[óo]stic\w*/i, /\bdiagnostica\w*/i, /\bterap\w*/i, /\btratamento\w*/i, /\btrata(r)?\b/i, /\bcura(r)?\b/i, /\btranstorno\w*/i, /\bdist[úu]rbio\w*/i, /\bcl[íi]nic\w*/i, /\bsintoma\w*/i, /\bcrise\w*/i],
  ru: [/диагн/i, /терапи/i, /терапевт/i, /лечени/i, /лечит/i, /излеч/i, /расстройств/i, /клиническ/i, /симптом/i, /кризис/i],
  tr: [/\bteşhis\w*/i, /\bterapi\w*/i, /\btedavi\w*/i, /\bbozukluk\w*/i, /\bklinik\w*/i, /\bsemptom\w*/i, /\bkriz\w*/i],
  id: [/\bdiagnosis\b/i, /\bmendiagnosis\b/i, /\bterapi\b/i, /\bpengobatan\b/i, /\bmengobati\b/i, /\bmenyembuhkan\b/i, /\bklinis\b/i, /\bgejala\b/i, /\bkrisis\b/i],
  vi: [/chẩn đoán/i, /trị liệu/i, /điều trị/i, /chữa/i, /rối loạn/i, /lâm sàng/i, /triệu chứng/i, /khủng hoảng/i],
  hi: [/निदान/, /थेरेपी/, /चिकित्सा/, /उपचार/, /इलाज/, /विकार/, /नैदानिक/, /लक्षण/, /संकट/],
  ja: [/診断/, /治療/, /療法/, /セラピー/, /障害/, /臨床/, /症状/, /危機/],
  ko: [/진단/, /치료/, /요법/, /테라피/, /장애/, /임상/, /증상/, /위기/],
  'zh-CN': [/诊断/, /治疗/, /疗法/, /治愈/, /障碍/, /临床/, /症状/, /危机/],
  ar: [/تشخيص/, /علاج/, /يعالج/, /شفاء/, /اضطراب/, /سريري/, /أعراض/, /أزمة/],
};

export type WordingHit = { language: string; key: string; text: string; pattern: string };

/** Every banned word in a locale table (keys in EXEMPT_KEYS skipped). Unknown languages are checked with English. */
export function findBannedWords(language: string, table: Record<string, string>): WordingHit[] {
  const patterns = [...(PATTERNS[language] ?? []), ...(language === 'en' ? [] : PATTERNS.en)];
  const hits: WordingHit[] = [];
  for (const [key, text] of Object.entries(table)) {
    if (EXEMPT_KEYS.includes(key)) continue;
    for (const p of patterns) if (p.test(text)) hits.push({ language, key, text, pattern: p.source });
  }
  return hits;
}
