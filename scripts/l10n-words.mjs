// Prints three words of a locale for the language flow, each with spaces as "\s" (no spaces → one shell word) and
// regex specials / trailing question marks removed: home.question, default.mood.4, backup.title.
// Usage: node scripts/l10n-words.mjs <lang>
import { readFileSync } from 'node:fs';

const lang = process.argv[2];
const file = new URL(`../src/i18n/${lang}.ts`, import.meta.url);
const text = readFileSync(file, 'utf8');
const get = (key) => {
  const m = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(text);
  if (!m) throw new Error(`${lang}: ${key} not found`);
  return m[2].replace(/\\(.)/g, '$1');
};
const clean = (s) => s.replace(/[?？؟]+$/u, '').replace(/[.*+()[\]{}|^$\\]/g, '.').replace(/ /g, '\\s');
console.log([get('home.question'), get('default.mood.4'), get('backup.title')].map(clean).join(' '));
