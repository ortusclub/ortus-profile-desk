const {test} = require('node:test');
const assert = require('node:assert/strict');
const {accountRows, sheetLocation, parseCSV} = require('../src/sheet-profiles.cjs');
const source = {id: 'test-sheet', gid: '123'};
const header = 'Email,Status,Full Name,VM Account ,Proxy Details,Passwords,2fa\n';
test('only active rows produce profiles, grouped by the exact VM Account value, without passwords or 2FA', () => {
  const data = accountRows(header + 'one@example.test,Active,One,GoLogin,192.0.2.1:8080:user:proxy-password,ACCOUNT-SECRET,TOTP-SECRET\n' +
    'two@example.test,Identity Restricted,Two,GoLogin,,,\nthree@example.test, active ,Three,,,,', source);
  assert.equal(data.profiles.length, 2); assert.deepEqual(data.summary.folders, {GoLogin: 1, Unassigned: 1});
  assert.equal(data.profiles[0].proxy.password, 'proxy-password'); assert.equal(data.inactiveKeys.length, 1);
  assert(!JSON.stringify(data).includes('ACCOUNT-SECRET')); assert(!JSON.stringify(data).includes('TOTP-SECRET'));
});
test('profile identity survives row reordering, renaming and moving folders', () => {
  const first = accountRows(header + 'one@example.test,Active,One,A,,,\ntwo@example.test,Active,Two,B,,,', source);
  const second = accountRows(header + 'two@example.test,Active,Two,C,,,\nONE@example.test,Active,Renamed,D,,,', source);
  assert.equal(first.profiles[0].sourceKey, second.profiles[1].sourceKey);
  assert.equal(first.profiles[1].sourceKey, second.profiles[0].sourceKey);
});
test('wrong tabs and duplicate active emails fail before applying changes', () => {
  assert.throws(() => accountRows('URL,Other\nexample,test', source), /must contain/);
  assert.throws(() => accountRows(header + 'one@example.test,Active,One,A,,,\nONE@example.test,Active,Two,B,,,', source), /same email/);
});
test('invalid proxies block the profile instead of silently opening it directly', () => {
  const data = accountRows(header + 'one@example.test,Active,One,A,malformed,,,', source);
  assert.equal(data.profiles[0].proxy.mode, 'blocked');
});
test('CSV supports quoted commas and newlines; source URL must explicitly select a Google tab', () => {
  assert.deepEqual(parseCSV('a,b\n"hello,\nworld","say ""hi"""'), [['a','b'], ['hello,\nworld','say "hi"']]);
  assert.equal(sheetLocation('https://docs.google.com/spreadsheets/d/test/edit#gid=123').gid, '123');
  assert.throws(() => sheetLocation('https://docs.google.com/spreadsheets/d/test/edit'), /including gid/);
  assert.throws(() => sheetLocation('http://localhost/secrets?gid=1'), /docs.google.com/);
});
