/**
 * @jest-environment node
 */
// Speed guard for the backup engine on a 3 MB photo (Node; device timing is P8's job).
import { nodeBackupCrypto } from '../node-backup-crypto';

import { buildBackupZip, openSealedBackup, readBackupZip, sealBackup } from '@/engine/backup-container';

it('3 MB backup: build, seal, open, read', async () => {
  const big = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
  const ms: Record<string, number> = {};
  let t = performance.now();
  const zip = buildBackupZip({ snapshot: { schemaVersion: 2, tables: {} }, photos: [{ name: 'big.jpg', bytes: big }], appVersion: '1', createdAt: 'x' });
  ms.build = performance.now() - t;
  t = performance.now();
  const sealed = await sealBackup(zip, { crypto: nodeBackupCrypto, password: 'pw', iterations: 1000, createdAt: 'x', appVersion: '1' });
  ms.seal = performance.now() - t;
  t = performance.now();
  const opened = await openSealedBackup(sealed, nodeBackupCrypto, 'pw');
  ms.open = performance.now() - t;
  t = performance.now();
  readBackupZip(opened);
  ms.read = performance.now() - t;
  console.log(ms);
  expect(ms.build + ms.seal + ms.open + ms.read).toBeLessThan(2000);
});
