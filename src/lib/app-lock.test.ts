import {
  canUseLock,
  gateAtStart,
  gateOnBackground,
  gateOnForeground,
  gateOnRecheck,
  gateOnUnlocked,
  shieldOnLeave,
  LOCK_AFTER_MS,
  MAX_DEFER_MS,
  lockUnavailableReason,
  type GateEnv,
  type LockCapability,
} from './app-lock';

const bio: LockCapability = { hasHardware: true, level: 'biometric' };
const pin: LockCapability = { hasHardware: false, level: 'secret' };
const none: LockCapability = { hasHardware: true, level: 'none' };
const noneNoHw: LockCapability = { hasHardware: false, level: 'none' };
const env = (over: Partial<GateEnv> = {}): GateEnv => ({ enabled: true, capability: bio, suspended: false, ...over });

describe('capability', () => {
  it('a passcode alone is enough; nothing set up is not', () => {
    expect(canUseLock(bio)).toBe(true);
    expect(canUseLock(pin)).toBe(true);
    expect(canUseLock(none)).toBe(false);
    expect(lockUnavailableReason(none)).toBe('noScreenLock');
    expect(lockUnavailableReason(noneNoHw)).toBe('noHardware');
    expect(lockUnavailableReason(bio)).toBeNull();
  });
});

describe('gate', () => {
  it('default off: never locks', () => {
    expect(gateAtStart(env({ enabled: false })).locked).toBe(false);
    const away = gateOnBackground(gateAtStart(env({ enabled: false })), 0);
    expect(gateOnForeground(away, 10 * LOCK_AFTER_MS, env({ enabled: false })).locked).toBe(false);
  });

  it('on: locked at start, unlocks, locks only after at least a minute away', () => {
    expect(gateAtStart(env()).locked).toBe(true);
    let state = gateOnUnlocked();
    state = gateOnBackground(state, 1000);
    expect(gateOnForeground(state, 1000 + LOCK_AFTER_MS - 1, env()).locked).toBe(false);
    expect(gateOnForeground(state, 1000 + LOCK_AFTER_MS, env()).locked).toBe(true);
  });

  it('a second background event does not reset the clock', () => {
    let state = gateOnBackground(gateOnUnlocked(), 0);
    state = gateOnBackground(state, 50_000);
    expect(gateOnForeground(state, LOCK_AFTER_MS, env()).locked).toBe(true);
  });

  it('never locks mid-capture: the lock is deferred and applies when the capture ends', () => {
    let state = gateOnBackground(gateOnUnlocked(), 0);
    state = gateOnForeground(state, 5 * LOCK_AFTER_MS, env({ suspended: true })); // scanner took 5 minutes
    expect(state).toEqual({ locked: false, awaySince: null, deferred: true });
    expect(gateOnRecheck(state, env({ suspended: true })).locked).toBe(false); // still capturing
    expect(gateOnRecheck(state, env({ suspended: false })).locked).toBe(true); // capture over
  });

  it('a short trip to the scanner never defers anything', () => {
    let state = gateOnBackground(gateOnUnlocked(), 0);
    state = gateOnForeground(state, 10_000, env({ suspended: true }));
    expect(state.deferred).toBe(false);
    expect(gateOnRecheck(state, env()).locked).toBe(false);
  });

  it('a lock the phone can no longer ask for opens the app (never locks the owner out)', () => {
    expect(gateAtStart(env({ capability: none })).locked).toBe(false);
    const locked = { locked: true, awaySince: null, deferred: false };
    expect(gateOnRecheck(locked, env({ capability: none })).locked).toBe(false);
    expect(gateOnForeground(gateOnBackground(gateOnUnlocked(), 0), 10 * LOCK_AFTER_MS, env({ capability: none })).locked).toBe(false);
  });

  it('switching the lock off clears a pending lock', () => {
    const state = { locked: false, awaySince: null, deferred: true };
    expect(gateOnRecheck(state, env({ enabled: false }))).toEqual({ locked: false, awaySince: null, deferred: false });
  });
});

describe('deferral cap (review finding 18)', () => {
  it('a capture flow left in the background for 10 minutes or more locks anyway (content stays mounted)', () => {
    const away = gateOnBackground(gateOnUnlocked(), 0);
    expect(gateOnForeground(away, MAX_DEFER_MS - 1, env({ suspended: true })).deferred).toBe(true);
    expect(gateOnForeground(away, MAX_DEFER_MS, env({ suspended: true }))).toEqual({ locked: true, awaySince: null, deferred: false });
  });
});

describe('cover when leaving the app (review finding 14)', () => {
  it('covers at once when the lock is on and the phone can ask', () => {
    expect(shieldOnLeave(env())).toBe(true);
    expect(shieldOnLeave(env({ capability: pin }))).toBe(true);
  });
  it('never while a capture/picker/share flow is open, with the lock off, without a screen lock, or before the setting was read', () => {
    expect(shieldOnLeave(env({ suspended: true }))).toBe(false);
    expect(shieldOnLeave(env({ enabled: false }))).toBe(false);
    expect(shieldOnLeave(env({ capability: none }))).toBe(false);
    expect(shieldOnLeave(null)).toBe(false);
  });
});

describe('Mood: lock after is a setting', () => {
  it('locks after the configured time, not before', () => {
    const env = { enabled: true, capability: { hasHardware: true, level: 'biometric' as const }, suspended: false, lockAfterMs: 300_000 };
    const away = gateOnBackground(gateOnUnlocked(), 0);
    expect(gateOnForeground(away, 299_000, env).locked).toBe(false);
    expect(gateOnForeground(away, 300_000, env).locked).toBe(true);
    expect(gateOnForeground(away, 1, { ...env, lockAfterMs: 0 }).locked).toBe(true);
    // an 'inactive' trip (system Face ID sheet) without 'background' never locks, even at 0 s
    expect(gateOnForeground(gateOnUnlocked(), 5, { ...env, lockAfterMs: 0 }).locked).toBe(false);
  });
});
