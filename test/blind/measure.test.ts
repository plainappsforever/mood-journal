/**
 * @jest-environment node
 */
// Blind-set MEASUREMENT harness (V1_PLAN P4, WORKFLOW L27 rules 5–7). Not a test of its own: it runs only when
// BLIND_DIR points at a folder of Daylio files written by a separate agent. Options per file, in this order:
//   `<name>.expected.json` → `options.today` / `options.mapping` (blind set format, test/blind/daylio-1/FORMAT.md),
//   else `<name>.mapping.json` ({ "mood name": level }) and BLIND_TODAY.
// Output: BLIND_OUT given → one `<name>.report.json` per file in that folder (for `check.py --compare <dir>`);
// otherwise one list in <BLIND_DIR>/engine-output.json. Run once, on the committed snapshot:
//   BLIND_DIR=test/blind/daylio-1 BLIND_OUT=test/blind/daylio-1/reports npx jest test/blind
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { importReport } from '@/engine/import-report';

const dir = process.env.BLIND_DIR;
const run = dir ? describe : describe.skip;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

run('blind Daylio set (measurement)', () => {
  it('writes the engine output for every file', () => {
    const skip = /\.(json|md|py)$/;
    const files = readdirSync(dir!, { withFileTypes: true })
      .filter((d) => d.isFile() && !skip.test(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
    const reports = files.map((f) => {
      const expected = readJson(join(dir!, `${f}.expected.json`)) as { options?: { today?: string; mapping?: Record<string, number> } } | undefined;
      const raw = expected?.options?.mapping ?? (readJson(join(dir!, `${f}.mapping.json`)) as Record<string, number> | undefined);
      const mapping = raw ? new Map(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v])) : undefined;
      const today = expected?.options?.today ?? process.env.BLIND_TODAY ?? '2026-10-16';
      return importReport(f, new Uint8Array(readFileSync(join(dir!, f))), { today, mapping });
    });
    const outDir = process.env.BLIND_OUT;
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      for (const r of reports) writeFileSync(join(outDir, `${r.file}.report.json`), JSON.stringify(r, null, 2) + '\n');
      console.log(`blind: ${reports.length} reports → ${outDir}`);
    } else {
      const out = join(dir!, 'engine-output.json');
      writeFileSync(out, JSON.stringify(reports, null, 2));
      console.log(`blind: ${reports.length} files → ${out}`);
    }
    expect(reports.length).toBeGreaterThan(0);
  });
});
