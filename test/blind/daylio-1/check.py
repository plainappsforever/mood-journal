#!/usr/bin/env python3
"""Blind Daylio fixture checker (stdlib only). Run with:  python3 -I check.py [--compare REPORTS]

Mode 1 (default): re-reads every fixture with an independent mini-reader written from FORMAT.md and checks that
<fixture>.expected.json agrees with the source file (entries, skipped rows, catalogue, counts, refusal class).

Mode 2 (--compare REPORTS): REPORTS is a directory of <fixture>.report.json files or one JSON file holding a list of
reports, in the ImportReport shape of the app's src/engine/import-report.ts ({file, status, error, entries, ...}).
Prints per-fixture results and the A5 number: share of expected entries reproduced exactly
(date, time, mood, level, activities, title, note, photos), plus refusal correctness.
"""
import base64, binascii, csv, datetime as dt, html, io, json, os, re, sys, zipfile
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {
    'current8': 'full_date,date,weekday,time,mood,activities,note_title,note',
    'current9_scales': 'full_date,date,weekday,time,mood,activities,scales,note_title,note',
    'legacy7': 'year,date,weekday,time,mood,activities,note',
    'de8_translated': 'Vollständiges Datum,Datum,Wochentag,Uhrzeit,Stimmung,Aktivitäten,Notiztitel,Notiz',
}
FAMILY = {'not_daylio': 'format', 'unrecognized_header': 'format', 'empty': 'format',
          'damaged_archive': 'damaged', 'damaged_csv': 'damaged', 'bad_payload': 'damaged', 'bad_shape': 'damaged',
          'encoding': 'encoding', 'encrypted': 'encrypted', 'zip64': 'zip64', 'date_format': 'date_format'}
DEFAULT_LEVEL = {'rad': 5, 'good': 4, 'meh': 3, 'bad': 2, 'awful': 1}
PREDEF = {1: 'rad', 2: 'good', 3: 'meh', 4: 'bad', 5: 'awful'}
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
GROUP = 'Imported from Daylio'


class Refuse(Exception):
    pass


def note_text(s):
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</p\s*>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    return html.unescape(s).rstrip('\n')


def akey(a):
    return sorted(a, key=lambda x: (x.casefold(), x))


def parse_time(s):
    s = s.strip()
    m = re.fullmatch(r'(\d{1,2}):(\d{2})', s)
    if m:
        h, mi = int(m[1]), int(m[2])
    else:
        m = re.fullmatch(r'(\d{1,2}):(\d{2})\s*([aApP])\.?[mM]\.?', s)
        if not m: return None
        h, mi = int(m[1]), int(m[2])
        if not 1 <= h <= 12: return None
        h = h % 12 + (12 if m[3] in 'pP' else 0)
    if h > 23 or mi > 59: return None
    return f'{h:02d}:{mi:02d}'


def parse_iso(s):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', s): return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def parse_legacy(year, cell):
    c = cell.strip().lower()
    m = re.fullmatch(r'(\d{1,2})-([a-z]{3})', c) or re.fullmatch(r'([a-z]+) (\d{1,2})', c)
    if not m: return None
    a, b = m[1], m[2]
    day, mon = (int(a), b) if a.isdigit() else (int(b), a)
    mi = next((i for i, n in enumerate(MONTHS) if n.startswith(mon)), None)
    try:
        return dt.date(int(year), mi + 1, day) if mi is not None else None
    except ValueError:
        return None


def read_csv(data, today, mapping):
    if not data: raise Refuse('empty')
    if data[:3] == b'\xef\xbb\xbf': data = data[3:]
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        raise Refuse('not_daylio' if b'\x00' in data[:64] and data[:2] not in (b'\xff\xfe', b'\xfe\xff') or data[:2] == b'\xff\xd8' else 'encoding')
    rdr = csv.reader(io.StringIO(text, newline=''), strict=True)
    try:
        rows = [(rdr.line_num, r) for r in rdr]
    except csv.Error:
        raise Refuse('damaged_csv')
    # csv.reader returns the line where a record ENDS; recompute start lines
    starts, prev = [], 0
    for end, r in rows:
        starts.append(prev + 1); prev = end
    if not rows: raise Refuse('empty')
    header = ','.join(rows[0][1])
    kind = next((k for k, h in HEADERS.items() if h == header), None)
    if kind is None: raise Refuse('unrecognized_header')
    cols = HEADERS[kind].split(',')
    n = len(cols)
    lo, hi = dt.date(1900, 1, 1), dt.date.fromisoformat(today) + dt.timedelta(days=1)
    entries, skipped, seen, reasons = [], [], set(), Counter()
    for i, ((_, r), line) in enumerate(zip(rows[1:], starts[1:]), start=1):
        def skip(reason):
            skipped.append({'line': line, 'row': i, 'reason': reason}); reasons[reason] += 1
        if len(r) != n: skip('column_count'); continue
        c = dict(zip(cols, r))
        if kind == 'legacy7':
            date = parse_legacy(c['year'], c['date'])
        elif kind == 'de8_translated':
            date = parse_iso(c['Vollständiges Datum'])
        else:
            date = parse_iso(c['full_date'])
        if date is None: skip('bad_date'); continue
        t = parse_time(c.get('time', c.get('Uhrzeit', '')))
        if t is None: skip('bad_time'); continue
        if not lo <= date <= hi: skip('out_of_range'); continue
        mood = c.get('mood', c.get('Stimmung'))
        acts_cell = c.get('activities', c.get('Aktivitäten', ''))
        acts = [a for a in acts_cell.split(' | ') if a != ''] if acts_cell else []
        title = c.get('note_title', c.get('Notiztitel', ''))
        note = c.get('note', c.get('Notiz', ''))
        key = (date, t, mood, tuple(acts), title, note)
        if key in seen: skip('duplicate'); continue
        seen.add(key)
        k = mood.strip().lower()
        lvl = mapping.get(k, DEFAULT_LEVEL.get(k))
        entries.append({'date': date.isoformat(), 'time': t, 'mood': mood.strip(), 'level': lvl, 'activities': akey(acts),
                        'title': title, 'note': note_text(note), 'photos': 0})
    if not entries and skipped and set(reasons) <= {'bad_date', 'bad_time'}:
        raise Refuse('date_format')
    acts = sorted({a for e in entries for a in e['activities']}, key=lambda x: (x.casefold(), x))
    return {'kind': 'daylio_csv', 'header': kind, 'entries': entries, 'skipped': skipped,
            'activities': [{'name': a, 'group': GROUP} for a in acts],
            'moods': sorted({e['mood'] for e in entries})}


def read_backup(data, today):
    if b'PK\x06\x06' in data[-200:] or b'PK\x06\x07' in data[-200:]: raise Refuse('zip64')
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise Refuse('damaged_archive')
    infos = zf.infolist()
    if any(zi.flag_bits & 1 for zi in infos): raise Refuse('encrypted')
    if any(b'\x01\x00' == zi.extra[:2] for zi in infos): raise Refuse('zip64')
    names = {zi.filename for zi in infos}
    if 'backup.daylio' not in names: raise Refuse('not_daylio')
    try:
        raw = zf.read('backup.daylio')
    except (zipfile.BadZipFile, zlib_error()):
        raise Refuse('damaged_archive')
    try:
        js = base64.b64decode(re.sub(rb'\s+', b'', raw), validate=True)
    except (binascii.Error, ValueError):
        raise Refuse('bad_payload')
    try:
        txt = js.decode('utf-8')
    except UnicodeDecodeError:
        raise Refuse('encoding')
    try:
        root = json.loads(txt)
    except ValueError:
        raise Refuse('bad_payload')
    if not isinstance(root, dict) or not isinstance(root.get('dayEntries'), list): raise Refuse('bad_shape')
    warnings = []
    if root.get('version') != 15: warnings.append('unknown_version')
    if root.get('goals'): warnings.append('goals_not_imported')
    if 'customMoods' in root:
        moods = {m['id']: ((m.get('custom_name') or '').strip() or PREDEF.get(m.get('predefined_name_id'), ''), 6 - m['mood_group_id']) for m in root['customMoods']}
    else:
        moods = {i: (PREDEF[i], 6 - i) for i in PREDEF}
    tags = {t['id']: t for t in root.get('tags', [])}
    groups = {g['id']: g['name'] for g in root.get('tag_groups', [])}
    assets = {a['id']: a for a in root.get('assets', [])}
    files = [n for n in names if n.startswith('assets/') or '/assets/' in n]
    lo, hi = dt.date(1900, 1, 1), dt.date.fromisoformat(today) + dt.timedelta(days=1)
    entries, skipped = [], []
    for e in root['dayEntries']:
        if e['mood'] not in moods:
            skipped.append({'daylio_id': e['id'], 'reason': 'unknown_mood'}); continue
        local = dt.datetime(1970, 1, 1) + dt.timedelta(milliseconds=e['datetime'] + e.get('timeZoneOffset', 0))
        if not lo <= local.date() <= hi:
            skipped.append({'daylio_id': e['id'], 'reason': 'out_of_range'}); continue
        if (e.get('year'), e.get('month'), e.get('day'), e.get('hour'), e.get('minute')) != (local.year, local.month - 1, local.day, local.hour, local.minute):
            if 'split_fields_mismatch' not in warnings: warnings.append('split_fields_mismatch')
        names_ = [tags[t]['name'] for t in e.get('tags', []) if t in tags]
        if any(t not in tags for t in e.get('tags', [])) and 'unknown_tag' not in warnings: warnings.append('unknown_tag')
        photos = 0
        for aid in e.get('assets', []):
            a = assets.get(aid)
            if a and a.get('type') == 1 and any(re.search(re.escape(a['checksum']) + r'(\.[A-Za-z0-9]+)?$', f) for f in files):
                photos += 1
        name, lvl = moods[e['mood']]
        entries.append({'date': local.date().isoformat(), 'time': f'{local.hour:02d}:{local.minute:02d}', 'mood': name, 'level': lvl,
                        'activities': akey(names_), 'title': e.get('note_title', ''), 'note': note_text(e.get('note', '')),
                        'photos': min(photos, 3), 'daylio_id': e['id'], 'utc_ms': e['datetime'],
                        'tz_offset_min': e.get('timeZoneOffset', 0) // 60000})
    acts = [{'name': t['name'], 'group': groups.get(t.get('id_tag_group'), GROUP), 'daylio_id': t['id'], 'state': t.get('state', 0)}
            for t in tags.values()]
    return {'kind': 'daylio_backup', 'entries': entries, 'skipped': skipped, 'warnings': warnings,
            'activities': sorted(acts, key=lambda a: (a['name'].casefold(), a['name'])),
            'moods': sorted({v[0] for v in moods.values()})}


def zlib_error():
    import zlib
    return zlib.error


def read_any(data, today, mapping):
    if data[:2] == b'PK': return read_backup(data, today)
    return read_csv(data, today, mapping)


def canon(e, keys=('date', 'time', 'mood', 'level', 'activities', 'title', 'note', 'photos')):
    return json.dumps([e.get(k) for k in keys], ensure_ascii=False)


def fixtures():
    for f in sorted(os.listdir(HERE)):
        if f.endswith('.expected.json'):
            yield f[:-len('.expected.json')], json.load(open(os.path.join(HERE, f), encoding='utf-8'))


def validate():
    bad = 0; n = 0
    for name, exp in fixtures():
        n += 1
        data = open(os.path.join(HERE, name), 'rb').read()
        opts = exp.get('options', {'today': '2026-10-16', 'mapping': {}})
        try:
            got = read_any(data, opts.get('today', '2026-10-16'), opts.get('mapping', {}))
        except Refuse as r:
            if 'refused' in exp and FAMILY[exp['refused']] == FAMILY[str(r)]:
                print(f'ok    {name}: refused ({r})')
            else:
                bad += 1; print(f'FAIL  {name}: checker refused {r}, expected {exp.get("refused", "import")}')
            continue
        if 'refused' in exp:
            bad += 1; print(f'FAIL  {name}: checker imported {len(got["entries"])} entries, expected refusal {exp["refused"]}'); continue
        probs = []
        ce = Counter(canon(e, tuple(e)) for e in exp['entries'])
        cg = Counter(canon(e, tuple(e)) for e in got['entries'])
        if ce != cg:
            probs.append(f'entries differ: {sum((ce - cg).values())} only expected, {sum((cg - ce).values())} only checker')
            for k in list((ce - cg))[:2]: probs.append('  expected: ' + k[:200])
            for k in list((cg - ce))[:2]: probs.append('  checker : ' + k[:200])
        if exp['kind'] != got['kind']: probs.append('kind differs')
        sk_e = sorted(json.dumps(s, sort_keys=True) for s in exp['skipped'])
        sk_g = sorted(json.dumps(s, sort_keys=True) for s in got['skipped'])
        if sk_e != sk_g: probs.append(f'skipped differ: {sk_e} vs {sk_g}')
        if [json.dumps(a, sort_keys=True) for a in exp['activities']] != [json.dumps(a, sort_keys=True) for a in got['activities']]:
            probs.append('activity catalogue differs')
        c = exp['counts']
        if c['entries'] != len(exp['entries']) or c['skipped'] != len(exp['skipped']) or c['activities'] != len(exp['activities']) \
                or c['photos'] != sum(e['photos'] for e in exp['entries']):
            probs.append('counts inconsistent with lists')
        if exp['kind'] == 'daylio_backup':
            for w in got['warnings']:
                if w not in exp['warnings']: probs.append(f'checker warning {w} not in expected warnings')
        else:
            if sorted(exp_m['name'] for exp_m in exp['moods']) != got['moods']: probs.append('mood list differs')
        if probs:
            bad += 1; print(f'FAIL  {name}:'); [print('      ' + p) for p in probs]
        else:
            print(f'ok    {name}: {len(got["entries"])} entries, {len(got["skipped"])} skipped')
    print(f'\n{n} fixtures, {bad} mismatches between expected.json and the independent reader')
    return 1 if bad else 0


# ------------------------------------------------------------------ compare mode

def load_reports(path):
    if os.path.isdir(path):
        reps = {}
        for f in os.listdir(path):
            if f.endswith('.report.json'):
                r = json.load(open(os.path.join(path, f), encoding='utf-8'))
                reps[os.path.basename(r.get('file') or f[:-len('.report.json')])] = r
        return reps
    data = json.load(open(path, encoding='utf-8'))
    return {os.path.basename(r['file']): r for r in data}


def norm(e):
    x = dict(e)
    x['mood'] = (x.get('mood') or '').strip().casefold()
    for k in ('title', 'note'):
        x[k] = (x.get(k) or '').replace('\r\n', '\n').rstrip()
    x['activities'] = akey(x.get('activities') or [])
    return x


def compare(path):
    reps = load_reports(path)
    tot = exact = normed = 0
    ref_ok = ref_bad = 0
    small_tot = small_exact = 0; fx_ok = fx_n = 0
    lines = []
    for name, exp in fixtures():
        r = reps.get(name)
        alt = exp.get('_meta', {}).get('also_acceptable', '')
        if r is None:
            lines.append(f'MISSING  {name}: no report'); tot += len(exp.get('entries', [])); continue
        if 'refused' in exp:
            n_ent = len(r.get('entries', []))
            if r.get('status') == 'error':
                ref_ok += 1; lines.append(f'ok       {name}: refused ({r.get("error")}; expected class {exp["refused"]})')
            elif n_ent == 0 and alt == 'ok_with_all_rows_skipped':
                ref_ok += 1; lines.append(f'ok       {name}: imported nothing, {len(r.get("skipped", []))} rows skipped')
            elif alt.startswith('ok'):
                ref_ok += 1; lines.append(f'ok*      {name}: imported {n_ent} entries (accepted alternative "{alt}")')
            else:
                ref_bad += 1; lines.append(f'FAIL     {name}: expected refusal ({exp["refused"]}) but status {r.get("status")} with {n_ent} entries' + (' — HALF IMPORT' if n_ent else ''))
            continue
        ee = exp['entries']; tot += len(ee)
        if r.get('status') == 'error':
            if alt.startswith('refused'):
                lines.append(f'ok*      {name}: refused ({r.get("error")}), accepted alternative "{alt}" — {len(ee)} entries not counted as misses')
                tot -= len(ee)
            else:
                lines.append(f'FAIL     {name}: refused ({r.get("error")}) but {len(ee)} entries expected')
            continue
        ge = r.get('entries', [])
        cg = Counter(canon(dict(e, activities=akey(e.get('activities', [])), mood=(e.get('mood') or '').strip())) for e in ge)
        cgn = Counter(canon(norm(e)) for e in ge)
        hit = hitn = 0; misses = []
        for e in ee:
            k = canon(e)
            if cg[k] > 0:
                cg[k] -= 1; hit += 1
            else:
                misses.append(e)
            kn = canon(norm(e))
            if cgn[kn] > 0:
                cgn[kn] -= 1; hitn += 1
        exact += hit; normed += hitn
        extra = len(ge) - hit
        fx_n += 1; fx_ok += hit == len(ee) and len(ge) == len(ee)
        if 'large' not in name:
            small_tot += len(ee); small_exact += hit
        st = 'ok' if hit == len(ee) and len(ge) == len(ee) else 'MISS'
        lines.append(f'{st:8s} {name}: {hit}/{len(ee)} exact, {hitn}/{len(ee)} normalised, engine entries {len(ge)} (extra/unmatched {extra}), skipped {len(r.get("skipped", []))} (expected {len(exp["skipped"])})')
        for m in misses[:3]:
            near = [g for g in ge if g.get('date') == m['date'] and g.get('time') == m['time']]
            if near:
                diff = {k: (m[k], near[0].get(k)) for k in ('mood', 'level', 'activities', 'title', 'note', 'photos') if canon({k: m[k]}, (k,)) != canon({k: near[0].get(k) if k != 'activities' else akey(near[0].get(k, []))}, (k,))}
                lines.append(f'           {m["date"]} {m["time"]} differs: ' + json.dumps(diff, ensure_ascii=False)[:300])
            else:
                lines.append(f'           {m["date"]} {m["time"]} {m["mood"]!r}: no engine entry at that date/time')
    print('\n'.join(lines))
    pct = 100.0 * exact / tot if tot else 100.0
    print(f'\nA5: {exact}/{tot} expected entries exact = {pct:.2f} %  (normalised: {normed}/{tot} = {100.0 * normed / tot if tot else 100:.2f} %)')
    print(f'A5 without the two *-large fixtures: {small_exact}/{small_tot} = {100.0 * small_exact / small_tot if small_tot else 100:.2f} %')
    print(f'importing fixtures fully exact: {fx_ok}/{fx_n}')
    print(f'refusals: {ref_ok} correct, {ref_bad} wrong')
    return 0


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--compare':
        sys.exit(compare(sys.argv[2]))
    sys.exit(validate())
