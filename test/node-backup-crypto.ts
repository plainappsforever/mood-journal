// BackupCrypto for Jest: Node's PBKDF2-SHA256 and AES-256-GCM (the app uses expo-crypto + PBKDF2, src/lib/backup-crypto.ts).
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

import type { BackupCrypto } from '@/engine/backup-container';

export const nodeBackupCrypto: BackupCrypto = {
  randomBytes: (n) => new Uint8Array(randomBytes(n)),
  async deriveKey(password, salt, iterations) {
    return pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt), iterations, 32, 'sha256');
  },
  async seal(key, plaintext) {
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key as Buffer, nonce);
    const body = Buffer.concat([c.update(plaintext), c.final()]);
    return new Uint8Array(Buffer.concat([nonce, body, c.getAuthTag()]));
  },
  async open(key, sealed) {
    const s = Buffer.from(sealed);
    const d = createDecipheriv('aes-256-gcm', key as Buffer, s.subarray(0, 12));
    d.setAuthTag(s.subarray(s.length - 16));
    return new Uint8Array(Buffer.concat([d.update(s.subarray(12, s.length - 16)), d.final()]));
  },
};
