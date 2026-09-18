const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-desk-ui-'));
app.setPath('userData', root);
const requests = [];
global.fetch = async (url, options) => {
  requests.push({url, method: options.method || 'GET'});
  if (url.includes('/browser/v2')) return {ok: true, json: async () => ({allProfilesCount: 1, profiles: [{id: 'test-remote', name: '<img src=x> Imported'}]})};
  if (url.endsWith('/cookies')) return {ok: true, json: async () => [{name: 'session', value: 'fixture-secret', domain: 'example.test', session: true}]};
  return {ok: true, json: async () => ({name: '<img src=x> Imported', proxy: {mode: 'gologin'}, canvas: {mode: 'noise'}})};
};
require('../src/main.cjs');
app.whenReady().then(async () => {
  try {
    let window;
    for (let tries = 0; tries < 100; tries++) {
      window = BrowserWindow.getAllWindows()[0];
      if (window && !window.webContents.isLoading()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(window, 'Window created');
    const result = await window.webContents.executeJavaScript(`(async () => {
      await window.desk.call('profiles:create', {name: 'Work profile'});
      await window.desk.call('profiles:create', {name: 'Personal profile'});
      const profiles = await window.desk.call('profiles:list');
      document.getElementById('search').dispatchEvent(new Event('input'));
      return {count: profiles.length, bridge: Boolean(window.desk), nodeHidden: typeof require === 'undefined', title: document.title};
    })()`);
    assert.equal(result.count, 2); assert(result.bridge); assert(result.nodeHidden); assert.equal(result.title, 'Ortus Profile Desk');
    const updateCheck = await window.webContents.executeJavaScript(`(async () => {
      const state = await window.desk.call('updates:status');
      const result = await window.desk.call('updates:check');
      let refusesUnprepared = false;
      try { await window.desk.call('updates:install'); } catch { refusesUnprepared = true; }
      return {version: state.version, status: result.status, refusesUnprepared,
        label: document.getElementById('check-updates').textContent};
    })()`);
    assert.equal(updateCheck.status, 'unavailable'); assert(updateCheck.refusesUnprepared);
    assert.equal(updateCheck.label, 'Check for updates');
    console.log('PASS: update controls, isolated update IPC and unprepared restart rejection.');
    const pasteCheck = await window.webContents.executeJavaScript(`(async () => {
      const profiles = await window.desk.call('profiles:list');
      await editSettings(profiles[0].id);
      const input = document.getElementById('proxy-paste');
      input.value = '192.0.2.1:11210:test-user:test:password';
      input.dispatchEvent(new Event('input'));
      const valid = input.checkValidity() && document.getElementById('proxy-host').value === '192.0.2.1'
        && document.getElementById('proxy-port').value === '11210' && document.getElementById('proxy-user').value === 'test-user'
        && document.getElementById('proxy-pass').value === 'test:password' && document.getElementById('proxy-mode').value === 'http';
      input.value = '192.0.2.1:99999:user:pass'; input.dispatchEvent(new Event('input'));
      const rejectsBadPort = !input.checkValidity();
      input.value = '192.0.2.1:11210:test-user:test:password'; input.dispatchEvent(new Event('input'));
      const closed = new Promise(resolve => document.getElementById('settings-dialog').addEventListener('close', resolve, {once: true}));
      document.getElementById('settings-form').requestSubmit();
      await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Settings did not save')), 5000))]);
      const saved = await window.desk.call('profiles:settings', {id: profiles[0].id});
      return {valid, rejectsBadPort, saved: saved.proxy.hasPassword && saved.proxy.host === '192.0.2.1' && saved.proxy.username === 'test-user', cleared: input.value === ''};
    })()`);
    assert.deepEqual(pasteCheck, {valid: true, rejectsBadPort: true, saved: true, cleared: true});
    console.log('PASS: pasted proxy fields, colon-containing password, invalid port rejection and saved credentials.');
    const migration = await window.webContents.executeJavaScript(`(async () => {
      const remote = await window.desk.call('gologin:connect', {token: 'test-fixture-token'});
      const result = await window.desk.call('gologin:import', {ids: [remote[0].id]});
      const duplicate = await window.desk.call('gologin:import', {ids: [remote[0].id]});
      await window.desk.call('gologin:disconnect');
      const profiles = await window.desk.call('profiles:list');
      return {result, duplicate, profiles};
    })()`);
    assert.equal(migration.result[0].status, 'imported'); assert.equal(migration.duplicate[0].status, 'skipped');
    assert.equal(migration.profiles.length, 3); assert.equal(migration.profiles[2].blocked, true);
    assert(!JSON.stringify(migration.profiles).includes('fixture-secret'));
    assert(requests.every(r => r.method === 'GET'));
    await window.webContents.executeJavaScript('refresh()');
    assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".profile-card img").length'), 0);
    await new Promise(resolve => setTimeout(resolve, 300));
    const screenshot = await window.webContents.capturePage();
    fs.mkdirSync(path.join(__dirname, '../test-artifacts'), {recursive: true});
    fs.writeFileSync(path.join(__dirname, '../test-artifacts/app.png'), screenshot.toPNG());
    await new Promise(resolve => { window.once('closed', resolve); window.close(); });
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    app.emit('second-instance', {}, [], process.cwd());
    const reopened = BrowserWindow.getAllWindows()[0];
    assert(reopened, 'Second launch recreates a closed window');
    for (let tries = 0; tries < 100 && !reopened.isVisible(); tries++) await new Promise(resolve => setTimeout(resolve, 100));
    assert(reopened.isVisible(), 'Reopened window is shown');
    reopened.minimize();
    app.emit('activate', {}, true);
    for (let tries = 0; tries < 30 && reopened.isMinimized(); tries++) await new Promise(resolve => setTimeout(resolve, 100));
    assert(!reopened.isMinimized(), 'Dock activation restores a minimized window');
    console.log('PASS: closing/reopening and restoring a minimized app window.');
    console.log('PASS: Electron window, isolated preload bridge, profile creation, encrypted storage and rendered UI.');
    app.exit(0);
  } catch (err) {console.error(err); app.exit(1);}
});
app.on('will-quit', () => fs.rmSync(root, {recursive: true, force: true}));
