import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { AutoBackupSection } from '@/components/auto-backup-section';
import { Button } from '@/components/button';
import { Card, Chip, Field, Label, Screen, SectionTitle, Small, ToggleRow, Wrap } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { getSetting, setSetting } from '@/db/settings';
import { addDays } from '@/engine/dates';
import { BackupError } from '@/engine/backup-container';
import type { Period } from '@/engine/stats';
import { useFormatter, useSettings } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { useLanguage } from '@/hooks/use-t';
import { createBackup, openBackup, restoreBackup, type OpenedBackup } from '@/lib/backup-io';
import { today as journalToday } from '@/lib/clock';
import { exportCsv, exportPdf } from '@/lib/export-io';
import { pickFile, shareFile } from '@/lib/files';
import type { MessageKey } from '@/lib/i18n';
import { formatDayShort } from '@/lib/locale';
import { write } from '@/lib/write';

const LAST_KEY = 'backup_last_manual_ms';
type PdfChoice = '7d' | '30d' | 'month' | 'year';

const backupMessage = (e: unknown): MessageKey =>
  e instanceof BackupError ? (`backup.error.${e.code}` as MessageKey) : 'backup.error.damaged';

// Backup & export (SPEC flows 8–9, A6, A9): manual backup through the share sheet (optionally encrypted), restore
// (replaces everything, confirmed), automatic backup into a chosen folder (AutoBackupSection), CSV and PDF exports.
export default function Backup() {
  const db = useSQLiteContext();
  const { t, locale } = useFormatter();
  const language = useLanguage();
  const settings = useSettings();
  const last = useLoad(() => getSetting(db, LAST_KEY), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [opened, setOpened] = useState<OpenedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfChoice, setPdfChoice] = useState<PdfChoice>('30d');
  const [pdfPhotos, setPdfPhotos] = useState(false);
  const today = journalToday(settings.dayEndHour);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const makeBackup = () =>
    run('backup', async () => {
      try {
        const b = await createBackup(db, password ? password : null);
        await write(() => setSetting(db, LAST_KEY, String(Date.now())));
        setAsking(false);
        setPassword('');
        setResult(t('backup.done', { name: b.name, entries: b.counts.entries, photos: b.counts.photos, kb: Math.max(1, Math.round(b.bytes / 1024)) }));
        console.log(`[backup] ${b.counts.entries} entries ${b.bytes} bytes snapshot=${b.ms.snapshot}ms zip=${b.ms.zip}ms seal=${b.ms.seal}ms`);
        await shareFile(b.file, 'application/octet-stream', 'public.data');
      } catch (e) {
        console.warn(e);
        setError(t('backup.error.create'));
      }
    });

  const tryOpen = async (file: { bytes: Uint8Array; name: string }, pw?: string) => {
    try {
      setOpened(await openBackup(file.bytes, pw));
      setPending(null);
    } catch (e) {
      if (e instanceof BackupError && (e.code === 'password-needed' || e.code === 'wrong-password')) setPending(file);
      setError(t(backupMessage(e)));
    }
  };

  const pickRestore = () =>
    run('restore', async () => {
      setOpened(null);
      setResult(null);
      const picked = await pickFile();
      if (picked.canceled) return;
      await tryOpen({ bytes: picked.bytes, name: picked.name });
    });

  const confirmRestore = (o: OpenedBackup) =>
    Alert.alert(t('backup.replaceTitle'), t('backup.replaceText', { entries: o.manifest.counts.entries }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.replaceConfirm'),
        style: 'destructive',
        onPress: () =>
          void run('restore', async () => {
            try {
              const r = await write(() => restoreBackup(db, o));
              console.log(`[restore] ${r.entries} entries ${r.photos} photos ${r.ms} ms`);
              setOpened(null);
              setResult(t('backup.restored', { entries: r.entries, photos: r.photos }));
            } catch (e) {
              console.warn(e);
              setError(t(backupMessage(e)));
            }
          }),
      },
    ]);

  const pdfPeriod = (): Period =>
    pdfChoice === '7d'
      ? { start: addDays(today, -6), end: today }
      : pdfChoice === '30d'
        ? { start: addDays(today, -29), end: today }
        : pdfChoice === 'month'
          ? { start: `${today.slice(0, 7)}-01`, end: today, kind: 'month' }
          : { start: `${today.slice(0, 4)}-01-01`, end: today, kind: 'year' };

  return (
    <Screen testID="backup-screen">
      <Stack.Screen options={{ title: t('backup.title') }} />
      {result ? (
        <Card>
          <Label testID="backup-result">{result}</Label>
        </Card>
      ) : null}
      {error ? (
        <Card>
          <Label testID="backup-error" danger>{error}</Label>
        </Card>
      ) : null}

      <SectionTitle>{t('backup.section')}</SectionTitle>
      <Card>
        <Small testID="backup-last">{last ? t('backup.last', { date: new Date(Number(last)).toLocaleString(locale) }) : t('backup.never')}</Small>
        {asking ? (
          <>
            <Field testID="backup-password" label={t('backup.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
            <Small>{t('backup.passwordHint')}</Small>
            <Button testID="backup-create" label={busy === 'backup' ? t('backup.working') : t('backup.create')} disabled={!!busy} onPress={() => void makeBackup()} />
          </>
        ) : (
          <Button testID="backup-now" label={t('backup.now')} disabled={!!busy} onPress={() => setAsking(true)} />
        )}
        <Small>{t('backup.contains')}</Small>
      </Card>

      <Card>
        <Button testID="restore" variant="secondary" label={busy === 'restore' ? t('backup.working') : t('backup.restore')} disabled={!!busy} onPress={() => void pickRestore()} />
        {pending ? (
          <>
            <Field testID="restore-password" label={t('backup.password')} value={restorePassword} onChangeText={setRestorePassword} secureTextEntry autoCapitalize="none" />
            <Button testID="restore-open" label={t('backup.open')} onPress={() => void run('restore', () => tryOpen(pending, restorePassword))} />
          </>
        ) : null}
        {opened ? (
          <>
            <Label testID="restore-counts">
              {t('backup.counts', { entries: opened.manifest.counts.entries, photos: opened.manifest.counts.photos, date: opened.manifest.createdAt.slice(0, 10) })}
            </Label>
            <Button testID="restore-confirm" label={t('backup.replace')} onPress={() => confirmRestore(opened)} />
          </>
        ) : null}
        <Small>{t('backup.restoreHint')}</Small>
      </Card>

      <SectionTitle>{t('backup.autoTitle')}</SectionTitle>
      <AutoBackupSection />

      <SectionTitle>{t('export.section')}</SectionTitle>
      <Card>
        <Button
          testID="export-csv"
          variant="secondary"
          label={busy === 'csv' ? t('backup.working') : t('export.csv')}
          disabled={!!busy}
          onPress={() =>
            void run('csv', async () => {
              try {
                const r = await exportCsv(db);
                setResult(t('export.csvDone', { n: r.rows }));
                await shareFile(r.file, 'text/csv', 'public.comma-separated-values-text');
              } catch (e) {
                // review S4: a failed export is shown, not swallowed
                console.warn(e);
                setError(t('error.generic'));
              }
            })
          }
        />
      </Card>
      <Card>
        <Label>{t('export.pdf')}</Label>
        <Wrap>
          {(['7d', '30d', 'month', 'year'] as PdfChoice[]).map((c) => (
            <Chip key={c} testID={`pdf-period-${c}`} label={t(`export.period.${c}`)} selected={pdfChoice === c} onPress={() => setPdfChoice(c)} />
          ))}
        </Wrap>
        <Small>{`${formatDayShort(locale, pdfPeriod().start)} – ${formatDayShort(locale, pdfPeriod().end)}`}</Small>
        <ToggleRow testID="pdf-photos" label={t('export.photos')} value={pdfPhotos} onChange={setPdfPhotos} />
        <Button
          testID="export-pdf"
          label={busy === 'pdf' ? t('backup.working') : t('export.pdfCreate')}
          disabled={!!busy}
          onPress={() =>
            void run('pdf', async () => {
              try {
                const r = await exportPdf(db, pdfPeriod(), { t, language, locale, includePhotos: pdfPhotos });
                console.log(`[pdf] pages=${r.info.pages} bytes=${r.info.bytes} entries=${r.entries} ${r.ms} ms`);
                setResult(t('export.pdfDone', { pages: r.info.pages || r.info.treeCount, entries: r.entries }));
                await shareFile(r.file, 'application/pdf', 'com.adobe.pdf');
              } catch (e) {
                console.warn(e);
                setError(t('export.pdfFailed'));
              }
            })
          }
        />
      </Card>
    </Screen>
  );
}
