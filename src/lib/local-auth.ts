import * as LocalAuthentication from 'expo-local-authentication';

import type { LockCapability } from './app-lock';

/** Reads what the phone can do. Never prompts and never asks for a permission. */
export async function getLockCapability(): Promise<LockCapability> {
  try {
    const [hasHardware, level] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.getEnrolledLevelAsync()]);
    return {
      hasHardware,
      level:
        level === LocalAuthentication.SecurityLevel.NONE
          ? 'none'
          : level === LocalAuthentication.SecurityLevel.SECRET
            ? 'secret'
            : 'biometric',
    };
  } catch {
    return { hasHardware: false, level: 'none' };
  }
}

/** Asks the phone to confirm the owner (face, fingerprint, or the phone's own passcode). True on success. */
export async function confirmOwner(promptMessage: string, cancelLabel: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: false });
    return result.success;
  } catch {
    return false;
  }
}
