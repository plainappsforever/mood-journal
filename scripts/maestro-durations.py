#!/usr/bin/env python3
# Prints, for every labelled Maestro wait ("label: T …") of the newest (or the given) run folder, the time from the START
# of the last tap before it to the END of the wait (a tap waits for the screen to settle, so the work it triggers runs
# inside the tap; the wait alone under-reports). Upper bound: includes Maestro's polling (~0.5 s) and, for a file pick,
# the picker closing. Release 20k import/backup/restore (P11). Usage: python3 -I scripts/maestro-durations.py [run-dir]
import json, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent / 'artifacts' / 'maestro'
run = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else max(root.iterdir(), key=lambda p: p.stat().st_mtime)
for commands in sorted(run.rglob('commands.json')):
    print(f'== {commands.parent.name}')
    last_tap = None
    for c in json.loads(commands.read_text()):
        meta = c.get('metadata', {})
        kind, inner = next(iter(meta.get('evaluatedCommand', c.get('command', {})).items()), (None, {}))
        if kind in ('tapOnElement', 'tapOnPoint', 'tapOnPointV2') and meta.get('status') == 'COMPLETED':
            last_tap = meta.get('timestamp')
        label = inner.get('label') if isinstance(inner, dict) else None
        if label:
            end = meta.get('timestamp', 0) + meta.get('duration', 0)
            since = (end - last_tap) / 1000 if last_tap else float('nan')
            print(f"{label}: {since:.1f} s from the tap (wait alone {meta.get('duration', 0) / 1000:.1f} s, {meta.get('status')})")
