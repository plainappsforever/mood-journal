import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Card, Chip, Label, Screen, SectionTitle, Small, Wrap } from '@/components/ui';
import { useSQLiteContext } from '@/db/provider';
import { ImportError, MAX_IMPORT_BYTES, type ImportSource, type ImportWarning } from '@/engine/daylio-common';
import { MappingNeededError, type ImportPlan } from '@/engine/import-plan';
import { useFormatter } from '@/hooks/use-journal';
import { FileTooLargeError, pickFile } from '@/lib/files';
import type { MessageKey, Translator } from '@/lib/i18n';
import { applyImport, planFor, readImportFile } from '@/lib/import-io';
import { formatDayShort } from '@/lib/locale';
import { write } from '@/lib/write';

function warningText(t: Translator, w: ImportWarning): string {
  return t(`import.warn.${w.code}` as MessageKey, w.params);
}

// Import from Daylio (SPEC flow 6, A5): pick → mood levels → preview → import → result. One transaction; existing
// entries are never changed; importing the same file again adds nothing.
export default function Import() {
  const db = useSQLiteContext();
  const { t, locale } = useFormatter();
  const [file, setFile] = useState<{ name: string; source: ImportSource } | null>(null);
  const [levels, setLevels] = useState<Map<string, number>>(new Map());
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);

  const replan = async (source: ImportSource, map: Map<string, number>) => {
    try {
      setPlan(await planFor(db, source, map, t('import.group.daylio')));
    } catch (e) {
      if (e instanceof MappingNeededError) setPlan(null);
      else throw e;
    }
  };

  const pick = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setPlan(null);
    try {
      const picked = await pickFile(MAX_IMPORT_BYTES);
      if (picked.canceled) return;
      const source = await readImportFile(db, picked.bytes);
      const map = new Map(source.moods.filter((m) => m.proposedLevel !== null).map((m) => [m.ref, m.proposedLevel as number]));
      setFile({ name: picked.name, source });
      setLevels(map);
      await replan(source, map);
    } catch (e) {
      setFile(null);
      if (!(e instanceof ImportError) && !(e instanceof FileTooLargeError)) console.warn(e);
      setError(e instanceof FileTooLargeError ? t('import.error.tooLarge') : e instanceof ImportError ? t(`import.error.${e.code}` as MessageKey) : t('import.error.damaged'));
    } finally {
      setBusy(false);
    }
  };

  const setLevel = (ref: string, level: number) => {
    if (!file) return;
    const map = new Map(levels).set(ref, level);
    setLevels(map);
    void replan(file.source, map);
  };

  const confirm = async () => {
    if (!plan || !file) return;
    setBusy(true);
    try {
      const r = await write(() => applyImport(db, plan, file.name));
      console.log(`[import] added=${r.added} duplicates=${r.duplicates} skipped=${r.skipped} photos=${r.photos} ${r.ms} ms`);
      setResult([
        t('import.result.added', { n: r.added }),
        t('import.result.duplicates', { n: r.duplicates }),
        t('import.result.skipped', { n: r.skipped }),
        t('import.result.photos', { n: r.photos }),
        ...plan.skipped.map((s) => t('import.result.skippedRow', { where: s.where, reason: s.reason })),
        ...plan.warnings.map((w) => warningText(t, w)),
        ...(file.source.goals > 0 ? [t('import.warn.goalsNotImported')] : []),
      ]);
      setFile(null);
      setPlan(null);
    } catch (e) {
      console.warn(e);
      setError(t('import.error.failed'));
    } finally {
      setBusy(false);
    }
  };

  const missing = file ? file.source.moods.filter((m) => !levels.has(m.ref)).length : 0;
  return (
    <Screen testID="import-screen">
      <Stack.Screen options={{ title: t('import.title') }} />
      <Small>{t('import.how')}</Small>
      <Button testID="import-pick" label={busy ? t('backup.working') : t('import.pick')} disabled={busy} onPress={() => void pick()} />
      {error ? (
        <Card testID="import-error">
          <Label danger>{error}</Label>
        </Card>
      ) : null}
      {file ? (
        <>
          <SectionTitle>{t('import.mapTitle')}</SectionTitle>
          <Small>{t('import.mapHint')}</Small>
          {file.source.moods.map((m, i) => (
            <Card key={m.ref} testID={`map-row-${i}`}>
              <Label>{m.name}</Label>
              <Wrap>
                {[5, 4, 3, 2, 1].map((n) => (
                  <Chip key={n} testID={`map-${i}-level-${n}`} label={String(n)} selected={levels.get(m.ref) === n} onPress={() => setLevel(m.ref, n)} />
                ))}
              </Wrap>
            </Card>
          ))}
          {missing > 0 ? <Small testID="import-missing">{t('import.mapMissing', { n: missing })}</Small> : null}
          {plan ? (
            <Card testID="import-preview">
              <Label>{t('import.preview.entries', { n: plan.counts.entries })}</Label>
              {plan.counts.first && plan.counts.last ? <Small>{`${formatDayShort(locale, plan.counts.first)} – ${formatDayShort(locale, plan.counts.last)}`}</Small> : null}
              <Small>{t('import.preview.details', { duplicates: plan.counts.duplicates, skipped: plan.counts.skipped, photos: plan.counts.photos, moods: plan.counts.newMoods, activities: plan.counts.newActivities })}</Small>
              {plan.warnings.slice(0, 20).map((w, i) => (
                <Small key={i}>{warningText(t, w)}</Small>
              ))}
              <Button testID="import-confirm" label={busy ? t('backup.working') : t('import.confirm', { n: plan.counts.entries })} disabled={busy || plan.counts.entries === 0} onPress={() => void confirm()} />
            </Card>
          ) : null}
        </>
      ) : null}
      {result ? (
        <Card testID="import-result">
          <View style={{ gap: 4 }}>
            {result.map((line, i) => (
              <Label key={i}>{line}</Label>
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
