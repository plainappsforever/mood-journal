// Builds Daylio-like backup ZIPs for tests from readable JSON (TUNING fixtures, D24).
import { strToU8, zipSync } from 'fflate';

import fixture from './backup-v15.json';

export const BACKUP_V15 = fixture;
export const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function buildDaylioZip(
  json: unknown = fixture,
  opts: { raw?: boolean; members?: Record<string, Uint8Array>; mainName?: string; wrapLines?: boolean } = {}
): Uint8Array {
  const text = JSON.stringify(json);
  let payload = opts.raw ? text : base64(strToU8(text));
  if (opts.wrapLines && !opts.raw) payload = payload.replace(/(.{76})/g, '$1\n');
  return zipSync({ [opts.mainName ?? 'backup.daylio']: strToU8(payload), 'assets/abc123.jpg': PHOTO_BYTES, ...opts.members });
}

/** Sets the "encrypted" general-purpose flag on every member (local and central headers). */
export function markEncrypted(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out[i] | (out[i + 1] << 8) | (out[i + 2] << 16) | (out[i + 3] << 24);
    if (sig === 0x04034b50) out[i + 6] |= 1;
    if (sig === 0x02014b50) out[i + 8] |= 1;
  }
  return out;
}

/** Pretends to be ZIP64: member count 0xFFFF in the end record. */
export function markZip64(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  for (let i = out.length - 22; i >= 0; i--) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 5 && out[i + 3] === 6) {
      out[i + 10] = 0xff;
      out[i + 11] = 0xff;
      break;
    }
  }
  return out;
}
