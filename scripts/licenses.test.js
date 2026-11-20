// D19: the Licences screen shows src/content/licenses.generated.json. It must match what scripts/licenses.js writes from
// package.json, node_modules, LICENSE and LICENSES/ today. Fix a failure here with `npm run licenses`, then commit the file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildLicenses, render, OUTPUT } = require('./licenses');

const ROOT = path.join(__dirname, '..');

describe('licenses.generated.json', () => {
  it('is up to date', () => {
    const committed = fs.readFileSync(path.join(ROOT, OUTPUT), 'utf8');
    if (committed !== render(buildLicenses(ROOT))) {
      throw new Error(
        `${OUTPUT} is out of date (dependencies, LICENSE or LICENSES/ changed). Run "npm run licenses" and commit the result.`
      );
    }
  });

  it('lists the app first, every direct dependency, and a non-empty text for each entry', () => {
    const entries = JSON.parse(fs.readFileSync(path.join(ROOT, OUTPUT), 'utf8'));
    const pkg = require('../package.json');
    expect(entries[0].name).toBe(pkg.name);
    expect(entries[0].license).toBe(pkg.license);
    const names = entries.map((e) => e.name);
    for (const dep of Object.keys(pkg.dependencies)) expect(names).toContain(dep);
    for (const e of entries) {
      expect(e.license).not.toBe('UNKNOWN');
      expect(e.text.length).toBeGreaterThan(50);
    }
    // sorted after the app's own entry
    const rest = names.slice(1);
    expect(rest).toEqual([...rest].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('reads files in LICENSES/ (SPDX id + name from the file name), NOTICE files and CRLF text, in a fixture', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'licenses-'));
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    write('package.json', JSON.stringify({ name: 'demo', version: '2.0.0', license: 'GPL-3.0-only', dependencies: { zeta: '1', alpha: '1' } }));
    write('LICENSE', 'GPL text\r\n');
    write('LICENSES/Apache-2.0-modnet.txt', 'Apache model licence\n');
    write('LICENSES/BSD-3-Clause-fsrs-rs.txt', 'BSD fsrs\n');
    write('node_modules/zeta/package.json', JSON.stringify({ name: 'zeta', version: '1.2.3', license: 'MIT' }));
    write('node_modules/zeta/LICENSE.md', 'zeta licence');
    write('node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '9.0.0', license: 'Apache-2.0' }));
    write('node_modules/alpha/LICENSE', 'alpha licence');
    write('node_modules/alpha/NOTICE', 'alpha notice');

    const entries = buildLicenses(dir);
    expect(entries.map((e) => [e.name, e.version, e.license])).toEqual([
      ['demo', '2.0.0', 'GPL-3.0-only'],
      ['alpha', '9.0.0', 'Apache-2.0'],
      ['fsrs-rs', '', 'BSD-3-Clause'],
      ['modnet', '', 'Apache-2.0'],
      ['zeta', '1.2.3', 'MIT'],
    ]);
    expect(entries[0].text).toBe('GPL text');
    expect(entries[1].text).toBe('alpha licence\n\n--- NOTICE ---\n\nalpha notice');
    expect(render(entries)).toBe(render(buildLicenses(dir)));
  });

  it('says plainly when a dependency is not installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'licenses-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { missing: '1' } }));
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'x'.repeat(100));
    expect(() => buildLicenses(dir)).toThrow(/not installed.*npm install, then npm run licenses/);
  });
});
