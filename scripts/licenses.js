#!/usr/bin/env node
// D19: builds src/content/licenses.generated.json, the data of the in-app Licences screen (src/app/licenses.tsx).
//   npm run licenses          rewrite the file (run after `npm install`, an upgrade, or a change in LICENSES/)
//   scripts/licenses.test.js  fails when the committed file differs from what this script would write
// Entries (no dependency, Node only):
//   1. the app itself: package.json name/version/license + the text of ./LICENSE (GPL-3.0 in the template);
//   2. every file in ./LICENSES/ (`<SPDX-id>-<name>.txt`, e.g. MIT-expo-template.txt, Apache-2.0-modnet.txt): the way an
//      app adds a notice that is no npm package (bundled model, font, data table, native library);
//   3. every package in package.json "dependencies" (direct, shipped): the declared licence + the package's LICENSE file
//      (+ its NOTICE file, which Apache-2.0 requires to travel along).
// Entry 1 comes first, the rest is sorted by name, version (plain code-point order, no locale), so the output is the same
// on every machine. Transitive packages are not listed (L11 in D19): add them by hand to LICENSES/ when one is bundled
// code the app ships on purpose.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join('src', 'content', 'licenses.generated.json');

// Display names for files in LICENSES/ whose file name is not a good title.
const NOTICE_NAMES = { 'MIT-expo-template': 'Expo template (650 Industries)' };

const LICENCE_FILE = /^(licen[cs]e|copying)([-._].*)?$/i;
const NOTICE_FILE = /^notice([-._].*)?$/i;

function normalise(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
}

function readFirst(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const names = fs
    .readdirSync(dir)
    .filter((n) => pattern.test(n) && fs.statSync(path.join(dir, n)).isFile())
    .sort();
  return names.length ? normalise(fs.readFileSync(path.join(dir, names[0]), 'utf8')) : null;
}

function declaredLicence(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(' OR ');
  return 'UNKNOWN';
}

function compare(a, b) {
  const key = (e) => [e.name, e.version, e.license];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/** The entries, in output order. Throws a plain-English Error when something cannot be resolved. */
function buildLicenses(root = ROOT) {
  const own = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const entries = [];

  const ownText = readFirst(root, /^licen[cs]e(\.(md|txt))?$/i);
  if (!ownText) throw new Error('No LICENSE file in the app folder: the app itself must be listed on the Licences screen.');
  const first = { name: own.name, version: own.version ?? '', license: declaredLicence(own), text: ownText };

  const noticeDir = path.join(root, 'LICENSES');
  if (fs.existsSync(noticeDir)) {
    for (const file of fs.readdirSync(noticeDir).sort()) {
      if (!fs.statSync(path.join(noticeDir, file)).isFile()) continue;
      const stem = file.replace(/\.(txt|md)$/i, '');
      // `MIT-expo-template` -> MIT, `Apache-2.0-modnet` -> Apache-2.0, `BSD-3-Clause-fsrs-rs` -> BSD-3-Clause.
      const m = /^((?:Apache-2\.0|BSD-[23]-Clause|GPL-[23]\.0(?:-only|-or-later)?|LGPL-[23]\.[01](?:-only|-or-later)?|MPL-2\.0|CC-BY(?:-SA)?-4\.0|CC0-1\.0|OFL-1\.1|0BSD|ISC|MIT|Unlicense|Zlib))-(.+)$/.exec(stem);
      const licence = m ? m[1] : 'UNKNOWN';
      const name = NOTICE_NAMES[stem] ?? (m ? m[2] : stem);
      entries.push({ name, version: '', license: licence, text: normalise(fs.readFileSync(path.join(noticeDir, file), 'utf8')) });
    }
  }

  for (const dep of Object.keys(own.dependencies ?? {})) {
    const dir = path.join(root, 'node_modules', dep);
    const pjPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pjPath)) {
      throw new Error(`Package ${dep} is not installed in node_modules. Run npm install, then npm run licenses.`);
    }
    const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
    const licence = declaredLicence(pj);
    let text = readFirst(dir, LICENCE_FILE);
    const notice = readFirst(dir, NOTICE_FILE);
    if (!text) {
      // Some Expo packages ship no LICENSE file; say so instead of inventing a text (the Expo MIT notice in LICENSES/ covers
      // the same repository). A package that declares anything else than MIT here needs a hand-added file in LICENSES/.
      const repo = typeof pj.repository === 'string' ? pj.repository : (pj.repository?.url ?? '');
      text = `This package ships no licence file. Declared licence in its package.json: ${licence}.${repo ? ` Source: ${repo.replace(/^git\+/, '')}` : ''}`;
    }
    if (notice) text = `${text}\n\n--- NOTICE ---\n\n${notice}`;
    entries.push({ name: dep, version: pj.version, license: licence, text });
  }

  entries.sort(compare);
  return [first, ...entries];
}

function render(entries) {
  return `${JSON.stringify(entries, null, 1)}\n`;
}

module.exports = { buildLicenses, render, OUTPUT };

if (require.main === module) {
  try {
    const out = render(buildLicenses());
    const file = path.join(ROOT, OUTPUT);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out);
    console.log(`licenses: ${JSON.parse(out).length} entries, ${(out.length / 1024).toFixed(0)} KB -> ${OUTPUT}`);
  } catch (e) {
    console.error(`licenses: ${e.message}`);
    process.exit(1);
  }
}
