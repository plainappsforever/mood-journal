const { BACKUP_RULES, DATA_EXTRACTION_RULES } = require('./with-backup-rules');

test('no cloud backup of any app data domain (SPEC Privacy); device transfer keeps the default', () => {
  for (const d of ['database', 'file', 'sharedpref', 'root']) {
    expect(DATA_EXTRACTION_RULES).toContain(`<exclude domain="${d}" path="." />`);
    expect(BACKUP_RULES).toContain(`<exclude domain="${d}" path="." />`);
  }
  expect(DATA_EXTRACTION_RULES).toContain('<cloud-backup>');
  expect(DATA_EXTRACTION_RULES).not.toContain('<device-transfer>');
});
