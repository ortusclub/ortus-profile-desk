const {app, BrowserWindow, ipcMain, dialog, safeStorage, Menu, shell} = require('electron');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {Store} = require('./store.cjs');
const {Updates} = require('./updates.cjs');
let updates;
const {BrowserManager} = require('./browser.cjs');
const {GoLoginAPI, validateProxy, safeStartUrl} = require('./migration.cjs');

let window, store, browsers, api = null, remoteProfiles = [], importing = false, quitting = false;
// Preserve the original Keychain identity and data location across the visible rename.
app.setName('Profile Desk');
app.setAboutPanelOptions({applicationName: 'Ortus Profile Desk'});
const uiPath = path.join(__dirname, '../ui/index.html');
const uiUrl = pathToFileURL(uiPath).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (store) showWindow(); });
  app.whenReady().then(() => {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable. Unlock your login keychain and reopen Ortus Profile Desk.');
      store = new Store(path.join(app.getPath('userData'), 'vault'), safeStorage);
      browsers = new BrowserManager(store, () => { if (window && !window.isDestroyed()) window.webContents.send('profiles-changed'); });
      updates = new Updates(app, state => { if (window && !window.isDestroyed()) window.webContents.send('updates-changed', state); });
      registerIPC(); createWindow();
      if (app.isPackaged) {setTimeout(() => updates.check(), 15000).unref(); setInterval(() => updates.check(), 4 * 60 * 60 * 1000).unref();}
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        {label: 'Ortus Profile Desk', submenu: [{role: 'about'}, {type: 'separator'}, {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]},
        {label: 'Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]},
        {label: 'Window', submenu: [{role: 'minimize'}, {role: 'zoom'}, {role: 'front'}]}
      ]));
    } catch (err) { dialog.showErrorBox('Could not open Ortus Profile Desk', err.message); app.quit(); }
  });
  app.on('activate', () => { if (store) showWindow(); });
  app.on('before-quit', event => {
    if (quitting) return;
    if (importing || [...(browsers?.active.values() || [])].some(p => p.state === 'opening')) {
      event.preventDefault(); dialog.showErrorBox('Please wait', 'A profile is opening or importing. Let it finish before quitting.'); return;
    }
    if (browsers?.active.size) {
      event.preventDefault();
      quitting = true;
      browsers.closeAll().then(() => app.quit()).catch(() => {quitting = false; dialog.showErrorBox('Could not close a profile', 'Close the remaining profile windows, then quit again.');});
    }
  });
}

function showWindow() {
  if (!window || window.isDestroyed()) { createWindow(); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  app.focus({steal: true});
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({width: 1150, height: 790, minWidth: 850, minHeight: 620,
    title: 'Ortus Profile Desk', show: false, backgroundColor: '#f5f6f8', titleBarStyle: 'hiddenInset',
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false}});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  const created = window;
  created.on('closed', () => { if (window === created) window = null; });
  created.once('ready-to-show', () => { if (!created.isDestroyed()) showWindow(); });
  created.loadFile(uiPath).catch(() => {
    dialog.showErrorBox('Could not load Ortus Profile Desk', 'The app interface could not be loaded. Reinstall Ortus Profile Desk and try again.');
  });
}

function handle(name, action) {
  ipcMain.handle(name, async (event, input) => {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== uiUrl) throw new Error('Untrusted app request.');
    try {return {ok: true, value: await action(input)};}
    catch (err) {
      let message = String(err.message || 'The operation failed.');
      if (api?.token) message = message.split(api.token).join('[redacted]');
      message = message.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@');
      return {ok: false, error: message.slice(0, 500)};
    }
  });
}

function registerIPC() {
  handle('updates:status', () => updates.state);
  handle('updates:check', () => updates.check());
  handle('updates:install', async () => {
    if (importing || browsers.active.size) throw new Error('Close all profiles and wait for imports to finish before updating.');
    await updates.install(); app.quit();
  });
  handle('profiles:list', () => store.list(browsers.active));
  handle('profiles:create', ({name}) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new Error('Enter a profile name of up to 160 characters.');
    store.add({name: name.trim(), notes: '', proxy: {mode: 'direct'}, startUrl: '', cookies: [], cookieImport: {status: 'none'}});
  });
  handle('profiles:open', async ({id}) => {await browsers.open(id);});
  handle('profiles:close', async ({id}) => {await browsers.close(id);});
  handle('profiles:settings', ({id}) => {
    const p = store.get(id);
    return {id, name: p.name, notes: p.notes || '', startUrl: p.startUrl || '', proxy: {...p.proxy, password: '', hasPassword: Boolean(p.proxy.password)}};
  });
  handle('profiles:update', ({id, name, notes, startUrl, proxy}) => {
    if (browsers.active.has(id)) throw new Error('Close the profile before changing its settings.');
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new Error('Enter a profile name of up to 160 characters.');
    if (typeof notes !== 'string' || notes.length > 10000) throw new Error('Notes are too long.');
    if (startUrl && safeStartUrl(startUrl) === 'about:blank') throw new Error('Start page must be an http:// or https:// address.');
    const old = store.get(id).proxy;
    if (proxy.keepPassword && proxy.mode === old.mode && proxy.host === old.host && Number(proxy.port) === old.port && proxy.username === old.username) proxy.password = old.password;
    store.update(id, {name: name.trim(), notes, startUrl, proxy: validateProxy(proxy)});
  });
  handle('gologin:connect', async ({token}) => {
    if (importing) throw new Error('Wait for the current import to finish.');
    api = null; remoteProfiles = [];
    const candidate = new GoLoginAPI(token);
    const profiles = await candidate.list();
    api = candidate; remoteProfiles = profiles;
    const imported = new Set(store.data.profiles.map(p => p.sourceId));
    return profiles.map(p => ({...p, imported: imported.has(p.id)}));
  });
  handle('gologin:disconnect', () => { if (importing) throw new Error('Wait for the import to finish.'); api = null; remoteProfiles = []; });
  handle('gologin:import', async ({ids}) => {
    if (!api) throw new Error('Connect to GoLogin first.');
    if (importing) throw new Error('An import is already running.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !remoteProfiles.some(p => p.id === id))) throw new Error('Select profiles from your connected account.');
    importing = true;
    const results = [];
    try {
      for (const id of [...new Set(ids)]) {
        const name = remoteProfiles.find(p => p.id === id).name;
        try {
          if (store.data.profiles.some(p => p.sourceId === id)) {results.push({id, name, status: 'skipped', message: 'Already imported; local session kept.'}); continue;}
          const imported = await api.profile(id);
          store.add({...imported, sourceId: id, name: String(imported.source.name || name), notes: String(imported.source.notes || ''),
            startUrl: safeStartUrl(imported.source.startUrl), cookieImport: {status: 'pending'}});
          results.push({id, name, status: 'imported'});
        } catch (err) {results.push({id, name, status: 'failed', message: /GoLogin|cookie|profile|vault|token|permission/i.test(err.message) ? err.message : 'Import failed; the source profile was not changed.'});}
        if (window && !window.isDestroyed()) window.webContents.send('import-progress', {completed: results.length, total: ids.length, name});
      }
    } finally {importing = false;}
    return results;
  });
  handle('data:reveal', () => {shell.showItemInFolder(store.file);});
}
