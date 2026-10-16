// The optional app lock (SPEC Lock, A10; ported from warranty-wallet D22/D65). Pure decisions; `local-auth.ts` talks to
// the phone and `components/app-lock-gate.tsx` draws the lock screen. Mood: "lock after" is a setting (lock_after_s).
//
// Rules: default off · locks when the app opens and after ≥ 60 s in the background · never while a capture is in
// progress (scanner, photo/PDF pick, Review, the backup/restore pickers and share sheets): the lock is only
// DEFERRED and applies when that flow ends (or when the app was away ≥ 10 min) · a lock the phone can no longer ask for never locks the owner out.

export const LOCK_AFTER_MS = 60_000; // default of the Mood setting lock_after_s (60)
/** A capture flow defers the lock at most this long away; after that it locks anyway (review finding 18). The
 * content stays mounted under the cover, so an open Review keeps its state. */
export const MAX_DEFER_MS = 10 * 60_000;

export type LockCapability = {
  hasHardware: boolean;
  /** 'none' = no screen lock or biometrics set up; 'secret' = PIN/pattern/passcode only; 'biometric' = face or finger. */
  level: 'none' | 'secret' | 'biometric';
};

/** True when the phone can actually ask (biometrics, or at least a passcode as the fallback). */
export function canUseLock(capability: LockCapability): boolean {
  return capability.level !== 'none';
}

/** Why the switch cannot be turned on yet; null when it can. */
export function lockUnavailableReason(capability: LockCapability): 'noScreenLock' | 'noHardware' | null {
  if (canUseLock(capability)) return null;
  return capability.hasHardware ? 'noScreenLock' : 'noHardware';
}

export type GateState = {
  locked: boolean;
  /** When the app went to the background; null while it is in front. */
  awaySince: number | null;
  /** The lock was due while a capture was in progress: apply it when that ends. */
  deferred: boolean;
};

export type GateEnv = {
  enabled: boolean;
  capability: LockCapability;
  /** A capture / picker / share flow is in progress. */
  suspended: boolean;
  /** Mood setting lock_after_s in ms (default LOCK_AFTER_MS); 0 = lock at once. */
  lockAfterMs?: number;
};

const active = (env: GateEnv) => env.enabled && canUseLock(env.capability);

/** On app start: locked when the lock is on and the phone can ask. */
export function gateAtStart(env: GateEnv): GateState {
  return { locked: active(env), awaySince: null, deferred: false };
}

export function gateOnBackground(state: GateState, now: number): GateState {
  return state.awaySince === null ? { ...state, awaySince: now } : state;
}

export function gateOnForeground(state: GateState, now: number, env: GateEnv): GateState {
  const away = state.awaySince === null ? 0 : now - state.awaySince;
  const next = { ...state, awaySince: null };
  if (!active(env)) return { locked: false, awaySince: null, deferred: false };
  // Only a real trip to the background counts: the system's own Face ID / passcode sheet makes the app 'inactive'
  // without 'background', and with "lock immediately" (0 s) that must not lock again (Mood P7, found on the simulator).
  if (state.awaySince === null) return next;
  if (away < (env.lockAfterMs ?? LOCK_AFTER_MS)) return next;
  return env.suspended && away < MAX_DEFER_MS ? { ...next, deferred: true } : { locked: true, awaySince: null, deferred: false };
}

/** After the capture flow ended or the setting changed: apply a deferred lock; drop everything when the lock is off. */
export function gateOnRecheck(state: GateState, env: GateEnv): GateState {
  if (!active(env)) return { locked: false, awaySince: null, deferred: false };
  if (state.deferred && !env.suspended) return { locked: true, awaySince: null, deferred: false };
  return state;
}

/**
 * Leaving the app (iOS `inactive`, any `background`) with the lock on: cover the content AT ONCE, before any
 * database read, so neither the return (≥ 60 s) nor the iOS app-switcher snapshot shows it (review finding 14).
 * Not during a capture/picker/share flow (those leave the app on purpose and must not flicker).
 */
export function shieldOnLeave(env: GateEnv | null): boolean {
  return env !== null && active(env) && !env.suspended;
}

export function gateOnUnlocked(): GateState {
  return { locked: false, awaySince: null, deferred: false };
}
