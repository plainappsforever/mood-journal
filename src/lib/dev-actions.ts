import { listActivities } from '@/db/activities';
import { exportSnapshot } from '@/db/backup-snapshot';
import { seedStatsFixture } from '@/db/dev';
import { listEntries, listStatEntries, loggedDates } from '@/db/entries';
import { getJournalSettings } from '@/db/settings';
import type { Db } from '@/db/types';
import { buildBackupZip, readBackupZip } from '@/engine/backup-container';
import { overview } from '@/engine/stats';
import { computeStreak } from '@/engine/streaks';
import { daylioBackupFixture, daylioCsvFixture, daylioCsvLarge } from '@/dev/fixtures';
import { setAutoKeep } from '@/lib/auto-backup';
import { lastBackupFile, restoreBackup } from '@/lib/backup-io';
import { now, offsetAt, today } from '@/lib/clock';
import { setDevPick } from '@/lib/files';
import { loadGoalViews } from '@/lib/goal-progress';
import { applyImport, planFor, readImportFile } from '@/lib/import-io';
import { makePeriod } from '@/lib/periods';
import { pushWidgets } from '@/lib/widgets';
import { getLocales } from 'expo-localization';
import { I18nManager } from 'react-native';
import { getLanguage } from '@/lib/i18n';

/**
 * Further dev links: `debug/fixture?name=stats`, `debug/perf`, `debug/pick?last=backup` (the next file pick returns the
 * last backup made), `debug/import-fixture?name=backup|csv` (the next pick returns a bundled Daylio file), `debug/s9`
 * (20k-entry import and restore timing, review S9), `debug/auto-keep?n=1` (rotation on a device with fewer files). Returns the result line of the debug screen.
 */
export async function runDevAction(db: Db, action: string, params: Record<string, string>): Promise<string> {
  if (action === 'fixture' && params.name === 'stats') {
    const settings = await getJournalSettings(db);
    await seedStatsFixture(db, today(settings.dayEndHour), offsetAt()(now()), now());
    return 'fixture stats';
  }
  if (action === 'perf') return perf(db);
  if (action === 'pick' && params.last === 'backup') {
    const file = lastBackupFile();
    if (!file) return 'no backup made yet';
    setDevPick(file.name, await file.bytes());
    return `next pick: ${file.name}`;
  }
  if (action === 'import-fixture') {
    if (params.name === 'csv') setDevPick('daylio_export.csv', daylioCsvFixture());
    else setDevPick('daylio-backup.daylio', daylioBackupFixture());
    return `next pick: daylio ${params.name ?? 'backup'}`;
  }
  if (action === 'auto-keep') {
    await setAutoKeep(db, Number(params.n ?? 10));
    return `auto keep ${params.n ?? 10}`;
  }
  if (action === 'rtl') {
    const l = getLocales()[0];
    return `rtl isRTL=${I18nManager.isRTL} locale=${l?.languageTag} dir=${l?.textDirection} lang=${getLanguage()}`;
  }
  if (action === 'widgets') {
    try {
      await pushWidgets(db);
      return 'widgets pushed';
    } catch (e) {
      return `widgets failed: ${String(e)} ${e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 5).join(' | ') : ''}`;
    }
  }
  if (action === 's9') return s9(db, Number(params.days ?? 4000), Number(params.perDay ?? 5));
  return `unknown action ${action}`;
}

/** A12 timing on the device: what Home and Stats "All time" do on open (database read + engines). */
async function perf(db: Db): Promise<string> {
  const settings = await getJournalSettings(db);
  const day = today(settings.dayEndHour);
  let t0 = Date.now();
  await listEntries(db, { limit: 60 });
  const streak = computeStreak(await loggedDates(db), day);
  await loadGoalViews(db, day, settings.weekStart);
  const home = Date.now() - t0;
  t0 = Date.now();
  const all = await listStatEntries(db);
  const read = Date.now() - t0;
  const acts = (await listActivities(db, { includeArchived: true })).map((a) => a.id);
  const first = all.reduce((m, e) => (e.date < m ? e.date : m), day);
  t0 = Date.now();
  overview(all, makePeriod('all', day, first), settings.weekStart, acts);
  const engine = Date.now() - t0;
  return `perf entries=${all.length} home=${home}ms statsRead=${read}ms statsEngine=${engine}ms statsTotal=${read + engine}ms streak=${streak.current}`;
}

/**
 * S9 (review): the real import path (read CSV → plan → one transaction) for a generated 20k-row Daylio CSV on an EMPTY
 * journal, then the real restore path (snapshot → ZIP → read → replace-all transaction) of that journal.
 */
async function s9(db: Db, days: number, perDay: number): Promise<string> {
  const settings = await getJournalSettings(db);
  const csv = daylioCsvLarge(days, perDay, today(settings.dayEndHour));
  let t0 = Date.now();
  const source = await readImportFile(db, csv);
  const read = Date.now() - t0;
  t0 = Date.now();
  const levels = new Map(source.moods.map((m) => [m.ref, m.proposedLevel ?? 3]));
  const plan = await planFor(db, source, levels, 'Imported from Daylio');
  const planMs = Date.now() - t0;
  const imported = await applyImport(db, plan, 's9.csv');
  t0 = Date.now();
  const snapshot = await exportSnapshot(db);
  const zip = buildBackupZip({ snapshot, photos: [], appVersion: 's9', createdAt: new Date().toISOString() });
  const backupMs = Date.now() - t0;
  t0 = Date.now();
  const opened = readBackupZip(zip);
  const openMs = Date.now() - t0;
  const restored = await restoreBackup(db, { encrypted: false, ...opened });
  return `s9 rows=${source.entries.length} read=${read}ms plan=${planMs}ms importTx=${imported.ms}ms added=${imported.added} | backup=${backupMs}ms bytes=${zip.length} open=${openMs}ms restoreTx=${restored.ms}ms restored=${restored.entries}`;
}
