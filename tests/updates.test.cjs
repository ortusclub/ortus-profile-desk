const {test} = require('node:test');
const assert = require('node:assert/strict');
const {newer, releaseInfo, Updates} = require('../src/updates.cjs');
test('updates compare numeric versions and refuse downgrades or malformed versions', () => {
  assert.equal(newer('0.1.10', '0.1.9'), true);
  for (const v of ['0.1.2', '0.1.3', '0.1.4-beta', '../../evil', '1.2']) assert.equal(newer(v, '0.1.3'), false);
  assert.equal(newer('1.0.0', '0.9.99'), true);
});
test('updates require stable releases and a checksum for the exact universal installer', () => {
  const release = {tag_name: 'v0.1.4', assets: [{name: 'Ortus-Profile-Desk-universal.dmg', digest: `sha256:${'a'.repeat(64)}`}]};
  assert.equal(releaseInfo(release, '0.1.3').version, '0.1.4');
  assert.equal(releaseInfo({...release, prerelease: true}, '0.1.3'), null);
  assert.equal(releaseInfo({...release, draft: true}, '0.1.3'), null);
  assert.equal(releaseInfo(release, '0.1.5'), null);
  assert.throws(() => releaseInfo({...release, assets: []}, '0.1.3'), /verified/);
  assert.throws(() => releaseInfo({...release, assets: [{...release.assets[0], digest: null}]}, '0.1.3'), /verified/);
});
test('development builds do not download updates and an unprepared update cannot install', async () => {
  const updater = new Updates({getVersion: () => '0.1.3', isPackaged: false}, () => {});
  assert.equal((await updater.check()).status, 'unavailable');
  await assert.rejects(updater.install(), /Check for updates/);
});

test('corrupt downloads never mount or prepare an application', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const updater = new Updates({getVersion: () => '0.1.3', isPackaged: true}, () => {});
  const calls = [];
  updater.run = async (program, args) => {
    calls.push([program, args]);
    if (args.some(a => a.startsWith('https://api.github.com/'))) return {stdout: JSON.stringify({tag_name: 'v0.1.4', assets: [{name: 'Ortus-Profile-Desk-universal.dmg', digest: `sha256:${'a'.repeat(64)}`} ]})};
    if (args.includes('-o')) {fs.writeFileSync(args.at(-1), 'corrupt'); return {};}
    throw new Error('Must not execute a downloaded file');
  };
  assert.equal((await updater.check()).status, 'error');
  assert.match(updater.state.message, /verification/);
  assert.equal(updater.ready, null);
  assert.equal(calls.length, 2);
  assert.equal(fs.existsSync(calls[1][1].at(-1)), false);
});
test('Network failures do not expose subprocess stderr', async () => {
  const updater = new Updates({getVersion: () => '0.1.3', isPackaged: true}, () => {});
  updater.run = async () => {throw new Error('secret-token-fixture');};
  const state = await updater.check();
  assert.equal(state.status, 'error'); assert(!state.message.includes('secret-token-fixture'));
});
