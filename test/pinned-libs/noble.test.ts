// The pinned P3 libraries (fflate 0.8.3, @noble/hashes 2.4.0) load under Jest (ESM transform exception in package.json).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { unzipSync, zipSync, strToU8 } from 'fflate';
it('fflate and @noble/hashes load and work', () => {
  expect(bytesToHex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(Object.keys(unzipSync(zipSync({ a: strToU8('x') })))).toEqual(['a']);
});
