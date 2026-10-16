// The app's crypto for the backup container (D18, WW D21): AES-256-GCM via expo-crypto, PBKDF2-SHA256 via
// @noble/hashes. Pure-JS PBKDF2 is ~100× slower on Hermes than native (WW measurement: ~8,000 rounds/s → 600,000
// rounds ≈ 75 s); the native PBKDF2 in modules/backup-folder is used, this stays as the fallback.
// Device glue: IMPLEMENTED BUT UNVERIFIED until P8 runs it on a simulator/emulator.
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, getRandomBytes } from 'expo-crypto';

import type { BackupCrypto } from '@/engine/backup-container';

import BackupFolder from '../../modules/backup-folder/src/BackupFolderModule';

/** Pure-JS PBKDF2 (fallback). The container already NFKC-normalised the password. */
export function pbkdf2KeyJs(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: 32 });
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

/** Native PBKDF2 (modules/backup-folder); the pure-JS one only if the module fails. */
export async function pbkdf2Key(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  try {
    return fromHex(await BackupFolder.pbkdf2Sha256(password, toHex(salt), iterations, 32));
  } catch (error) {
    if (__DEV__) console.warn('[backup] native PBKDF2 failed, using JS', error);
    return pbkdf2KeyJs(password, salt, iterations);
  }
}

export const expoBackupCrypto: BackupCrypto = {
  randomBytes: (count) => getRandomBytes(count),
  async deriveKey(password, salt, iterations) {
    return AESEncryptionKey.import(await pbkdf2Key(password, salt, iterations));
  },
  async seal(key, plaintext) {
    const sealed = await aesEncryptAsync(plaintext, key as AESEncryptionKey);
    return sealed.combined('bytes');
  },
  async open(key, sealed) {
    return aesDecryptAsync(AESSealedData.fromCombined(sealed), key as AESEncryptionKey, { output: 'bytes' });
  },
};
