const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {Store} = require('../src/store.cjs');
test('encrypted vault survives restart, rejects duplicate imports, and never exposes cookies in profile listing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-desk-store-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const key = crypto.randomBytes(32);
  const encryption = {encryptString(text) {const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([c.update(text), c.final()]); return Buffer.concat([iv, c.getAuthTag(), encrypted]);},
    decryptString(data) {const c = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); c.setAuthTag(data.subarray(12, 28)); return Buffer.concat([c.update(data.subarray(28)), c.final()]).toString();}};
  const store = new Store(root, encryption);
  const p = store.add({name: 'Test', sourceId: 'remote1', proxy: {mode: 'direct'}, cookies: [{value: 'COOKIE_SECRET'}]});
  assert(!fs.readFileSync(store.file).includes('COOKIE_SECRET'));
  assert(!JSON.stringify(store.list()).includes('COOKIE_SECRET'));
  const reopened = new Store(root, encryption); assert.equal(reopened.get(p.id).cookies[0].value, 'COOKIE_SECRET');
  assert.throws(() => reopened.add({sourceId: 'remote1'}), /already imported/);
  assert.throws(() => reopened.directory('../../escape'), /not found/);
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  const saved = fs.readFileSync(store.file); fs.writeFileSync(store.file, 'corrupted');
  assert.throws(() => new Store(root, encryption), /not been changed/); assert.equal(fs.readFileSync(store.file).toString(), 'corrupted');
  fs.writeFileSync(store.file, saved);
});
