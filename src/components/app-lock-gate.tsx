import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { getJournalSettings } from '@/db/settings';
import type { Db } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/hooks/use-t';
import BackupFolder from '../../modules/backup-folder/src/BackupFolderModule';
import {
  canUseLock,
  gateAtStart,
  gateOnBackground,
  gateOnForeground,
  gateOnRecheck,
  gateOnUnlocked,
  shieldOnLeave,
  type GateEnv,
  type GateState,
} from '@/lib/app-lock';
import { isLockSuspended, onLockRecheck } from '@/lib/lock-controller';
import { confirmOwner, getLockCapability } from '@/lib/local-auth';

async function readEnv(db: Db): Promise<GateEnv> {
  const [settings, capability] = await Promise.all([getJournalSettings(db), getLockCapability()]);
  const env = { enabled: settings.lockEnabled, capability, suspended: isLockSuspended(), lockAfterMs: settings.lockAfterS * 1000 };
  // Android: FLAG_SECURE while the lock is on (no screenshots, blank recent-apps thumbnail; SPEC Privacy).
  if (Platform.OS === 'android') BackupFolder.setSecureWindow(env.enabled && canUseLock(capability)).catch(() => undefined);
  return env;
}

/**
 * Covers the app with the lock screen when the lock is on (SPEC Lock; ported from warranty-wallet D22/D65). The app underneath stays mounted (no state is
 * lost) but is hidden from screen readers while locked. While the setting is still being read the cover is shown
 * too, so a locked app never flashes its content.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const t = useT();
  const [state, setState] = useState<GateState | null>(null);
  // Plain cover while the app is left / returning, until the foreground decision is made (review finding 14).
  const [shield, setShield] = useState(false);
  const lastEnv = useRef<GateEnv | null>(null);
  const prompting = useRef(false);
  const read = useCallback(async () => {
    const env = await readEnv(db);
    lastEnv.current = env;
    return env;
  }, [db]);

  useEffect(() => {
    let alive = true;
    read().then((env) => alive && setState(gateAtStart(env)));
    return () => {
      alive = false;
    };
  }, [read]);

  // Background ≥ 60 s → lock on return (unless a capture is in progress: then it waits). With the lock on, the
  // content is covered the moment the app is left (synchronously, from the last known setting) and stays covered
  // until the foreground decision below, so nothing flashes while the setting is read again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (next) => {
      if (next === 'inactive' || next === 'background') {
        if (shieldOnLeave(lastEnv.current ? { ...lastEnv.current, suspended: isLockSuspended() } : null)) setShield(true);
        if (next === 'background') setState((s) => (s ? gateOnBackground(s, Date.now()) : s));
      } else if (next === 'active') {
        const env = await read();
        setState((s) => (s ? gateOnForeground(s, Date.now(), env) : s));
        setShield(false); // same render as the decision (batched)
      }
    });
    return () => subscription.remove();
  }, [read]);

  // A capture ended or the setting changed.
  useEffect(
    () =>
      onLockRecheck(async () => {
        const env = await read();
        setState((s) => (s ? gateOnRecheck(s, env) : s));
      }),
    [read]
  );

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const capability = await getLockCapability();
      // Nothing to ask the phone any more: never lock the owner out.
      const ok = capability.level === 'none' ? true : await confirmOwner(t('lock.prompt'), t('common.cancel'));
      if (ok) setState(gateOnUnlocked());
    } finally {
      prompting.current = false;
    }
  }, [t]);

  const locked = state === null || state.locked || shield;
  const showUi = state?.locked === true;

  // Ask straight away when the lock screen appears (and the app is in front).
  useEffect(() => {
    if (showUi && AppState.currentState === 'active') unlock().catch(() => undefined);
  }, [showUi, unlock]);

  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={locked}>
        {children}
      </View>
      {locked ? (
        <View testID={showUi ? 'lock-screen' : 'lock-loading'} style={[styles.cover, { backgroundColor: theme.background }]}>
          {showUi ? (
            <View style={styles.box}>
              <ThemedText type="subtitle" style={styles.centered}>
                {t('lock.title')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.centered}>
                {t('lock.body')}
              </ThemedText>
              <Button testID="unlock" label={t('lock.unlock')} onPress={() => unlock()} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  box: { gap: Spacing.three, alignSelf: 'stretch', maxWidth: 420 },
  centered: { textAlign: 'center' },
});
