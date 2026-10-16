// "Automatic backup" on the Backup & export screen (SPEC flow 7, A7): switch → system folder picker → password
// (generated, editable, shown once with "write it down"; encryption on by default, D18) → status line. Failure: red
// status with the reason and "choose the folder again"; More shows a dot. No notification, no dialog on its own.
import { useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/button';
import { Card, Chip, Field, Label, Small, ToggleRow, Wrap } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { useFormatter } from '@/hooks/use-journal';
import { useLoad } from '@/hooks/use-load';
import { KEEP_CHOICES, lastOk } from '@/lib/auto-backup-plan';
import {
  autoStatusVersion,
  changeAutoFolder,
  disableAutoBackup,
  enableAutoBackup,
  newAutoPassword,
  readAutoConfig,
  readAutoPassword,
  runAutoBackup,
  setAutoKeep,
  subscribeAutoStatus,
} from '@/lib/auto-backup';
import { pickFolder, type Folder } from '@/lib/backup-folder';
import type { MessageKey } from '@/lib/i18n';

export function useAutoStatusVersion(): number {
  return useSyncExternalStore(subscribeAutoStatus, autoStatusVersion);
}

export function AutoBackupSection() {
  const db = useSQLiteContext();
  const { t, locale } = useFormatter();
  const version = useAutoStatusVersion();
  const config = useLoad(() => readAutoConfig(db), [version]);
  const [setup, setSetup] = useState<{ folder: Folder; password: string; encrypt: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!config) return null;

  const when = (ms: number) => new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      console.warn('auto-backup ui', e);
      setProblem(t('auto.pickFailed'));
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    guard(async () => {
      const folder = await pickFolder();
      if (!folder) return;
      setSetup({ folder, password: newAutoPassword(), encrypt: true });
    });

  const status = config.status;
  const ok = lastOk(status);

  return (
    <Card testID="auto-backup">
      <ToggleRow
        testID="auto-backup-toggle"
        label={t('auto.toggle')}
        value={config.on || !!setup}
        disabled={busy}
        onChange={(v) => {
          if (v) void turnOn();
          else {
            setSetup(null);
            void guard(() => disableAutoBackup(db));
          }
        }}
      />
      {setup ? (
        <>
          <Label testID="auto-backup-chosen">{t('auto.folder', { name: setup.folder.name })}</Label>
          <ToggleRow testID="auto-backup-encrypt" label={t('auto.encrypt')} value={setup.encrypt} onChange={(encrypt) => setSetup({ ...setup, encrypt })} />
          {setup.encrypt ? (
            <>
              <Field
                testID="auto-backup-password"
                label={t('auto.password')}
                value={setup.password}
                onChangeText={(password) => setSetup({ ...setup, password })}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Small muted={false}>{t('auto.writeDown')}</Small>
            </>
          ) : (
            <Small muted={false}>{t('auto.plainWarning')}</Small>
          )}
          <Button
            testID="auto-backup-save"
            label={t('auto.save')}
            disabled={busy || (setup.encrypt && setup.password.trim().length < 8)}
            onPress={() =>
              void guard(async () => {
                await enableAutoBackup(db, setup.folder, setup.encrypt ? setup.password.trim() : null);
                setSetup(null);
              })
            }
          />
          <Button testID="auto-backup-cancel" variant="secondary" label={t('common.cancel')} onPress={() => setSetup(null)} />
        </>
      ) : config.on && config.folder ? (
        <>
          <Button
            testID="auto-backup-folder"
            variant="secondary"
            label={t('auto.folderChange', { name: config.folder.name })}
            disabled={busy}
            onPress={() =>
              void guard(async () => {
                const folder = await pickFolder();
                if (folder) await changeAutoFolder(db, folder);
              })
            }
          />
          <Small testID="auto-backup-encryption">{config.encrypt ? t('auto.encrypted') : t('auto.plain')}</Small>
          {status && !status.ok ? (
            <Label testID="auto-backup-status" danger>
              {t('auto.failed', { reason: t(`auto.error.${status.error}` as MessageKey) })}
            </Label>
          ) : (
            <Small testID="auto-backup-status" muted={false}>
              {status?.ok ? t('auto.last', { date: when(status.atMs), name: status.name, n: status.files }) : t('auto.none')}
            </Small>
          )}
          {status && !status.ok && ok ? <Small>{t('auto.lastGood', { date: when(ok.atMs) })}</Small> : null}
          <Button
            testID="auto-backup-now"
            label={busy ? t('backup.working') : t('auto.now')}
            disabled={busy}
            onPress={() => void guard(async () => void (await runAutoBackup(db, true)))}
          />
          <Small>{t('auto.keep')}</Small>
          <Wrap>
            {KEEP_CHOICES.map((k) => (
              <Chip key={k} testID={`auto-keep-${k}`} label={k === 0 ? t('auto.keepAll') : String(k)} selected={config.keep === k} onPress={() => void setAutoKeep(db, k)} />
            ))}
          </Wrap>
          {config.encrypt ? (
            shown ? (
              <Label testID="auto-backup-password-shown">{shown}</Label>
            ) : (
              <Button testID="auto-backup-show-password" variant="secondary" label={t('auto.showPassword')} onPress={() => void readAutoPassword().then((p) => setShown(p ?? t('auto.error.password')))} />
            )
          ) : null}
          <Small>{t('auto.how')}</Small>
        </>
      ) : (
        <Small>{t('auto.off')}</Small>
      )}
      {problem ? <Label danger>{problem}</Label> : null}
    </Card>
  );
}

/** True while the last automatic backup failed (dot on More, SPEC "Failure → … a dot on More"). */
export function useAutoBackupFailed(): boolean {
  const db = useSQLiteContext();
  const version = useAutoStatusVersion();
  const config = useLoad(() => readAutoConfig(db), [version]);
  return !!config?.on && !!config.status && !config.status.ok;
}
