const $ = id => document.getElementById(id);
let selectedFolder = '', settingsVersion;
let profiles = [], remotes = [], importBusy = false, toastTimer, proxyPasswordProvided = false;
function toast(message, error = false) {clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = error ? 'error' : ''; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, error ? 12000 : 4500);}
async function perform(action) {try {return await action();} catch (err) {toast(err.message, true);}}
function element(tag, className, text) {const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el;}
function button(label, className, action) {const el = element('button', className, label); el.addEventListener('click', () => perform(async () => {el.disabled = true; try {await action();} finally {el.disabled = false;}})); return el;}
function view(name) {$('profiles-view').hidden = name !== 'profiles'; $('import-view').hidden = name !== 'import'; $('nav-profiles').classList.toggle('active', name === 'profiles'); $('nav-import').classList.toggle('active', name === 'import');}
async function refresh() {
  profiles = await window.desk.call('profiles:list'); render();
  const state = await window.desk.call('workspace:status');
  $('workspace-notice').hidden = false;
  $('connect-workspace').hidden = state.enabled && state.online;
  $('sync-profiles').hidden = !state.enabled;
  $('workspace-label').textContent = state.enabled ? (state.online ? 'Connected to Ortus' : 'Workspace offline') : 'Stored on this Mac';
  $('workspace-heading').textContent = state.enabled ? 'YOUR SHARED WORKSPACE' : 'YOUR LOCAL WORKSPACE';
  $('workspace-message').textContent = state.message || 'Connect your team workspace to load the company profiles and proxies.';
}
function render() {
  $('total-count').textContent = profiles.length; $('sidebar-count').textContent = profiles.length;
  $('open-count').textContent = profiles.filter(p => p.state !== 'closed').length;
  $('import-count').textContent = profiles.filter(p => p.sourceId).length;
  const counts = new Map();
  profiles.forEach(p => counts.set(p.folder || 'Unassigned', (counts.get(p.folder || 'Unassigned') || 0) + 1));
  if (selectedFolder && !counts.has(selectedFolder)) selectedFolder = '';
  $('folder-list').replaceChildren(); $('folders').replaceChildren();
  for (const [folder, count] of [...counts].sort((a,b) => a[0].localeCompare(b[0]))) {
    const b = button(`${folder} (${count})`, `nav folder${selectedFolder === folder ? ' active' : ''}`, () => {selectedFolder = folder;view('profiles');render();});
    $('folder-list').append(b);
    const option = element('option'); option.value = folder; $('folders').append(option);
  }
  const query = $('search').value.toLowerCase();
  const shown = profiles.filter(p => (!selectedFolder || p.folder === selectedFolder) && `${p.name} ${p.notes} ${p.email || ''} ${p.folder || ''}`.toLowerCase().includes(query));
  $('profile-list').replaceChildren(); $('empty').hidden = profiles.length !== 0;
  if (profiles.length && !shown.length) $('profile-list').append(element('p', 'hint', 'No profiles match your search.'));
  for (const p of shown) {
    const row = element('div', 'profile-card'); row.append(element('div', 'avatar', p.name.charAt(0).toUpperCase()));
    const info = element('div', 'profile-info'); info.append(element('div', 'profile-name', p.name));
    info.append(element('div', 'profile-meta', `${p.folder || 'Unassigned'} · ${p.shared ? 'Shared' : p.sourceId ? 'Imported' : 'Local'} · ${p.proxyLabel}`)); row.append(info);
    if (p.state !== 'closed') row.append(element('span', 'badge', p.state === 'open' ? 'Open' : p.state === 'opening' ? 'Opening…' : 'Closing…'));
    else if (p.blocked || p.cookieImport?.status === 'partial') row.append(element('span', 'badge warn', p.blocked ? 'Set proxy' : 'Review import'));
    const actions = element('div', 'profile-actions');
    if (p.report) {const report = button('Report', 'icon-button', () => showReport(p)); actions.append(report);}
    const settings = button('⚙', 'icon-button', () => editSettings(p.id)); settings.title = `Settings for ${p.name}`; settings.setAttribute('aria-label', settings.title); settings.disabled = p.state !== 'closed'; actions.append(settings);
    const open = button(p.state === 'open' ? 'Focus' : 'Open ↗', 'primary', async () => {await window.desk.call('profiles:open', {id: p.id}); await refresh();});
    open.disabled = p.blocked || ['opening', 'closing'].includes(p.state); actions.append(open);
    if (p.state === 'open') actions.append(button('Close', '', async () => {await window.desk.call('profiles:close', {id: p.id}); await refresh();}));
    row.append(actions); $('profile-list').append(row);
  }
}
function showReport(p) {
  const content = $('report-content'); content.replaceChildren(element('p', '', p.name));
  const c = p.cookieImport;
  const status = c?.status === 'pending' ? `${p.report.cookieCount} cookies ready for installation on first open.` : `${c?.imported || 0} cookies installed; ${c?.failed || 0} rejected by Chrome.`;
  content.append(element('div', 'report-note', status));
  content.append(element('div', 'report-note', `${p.report.skippedCookies.length} expired or unsupported cookies skipped during migration.`));
  for (const note of p.report.notes) content.append(element('div', 'report-note', note));
  $('report-dialog').showModal();
}
async function editSettings(id) {
  const p = await window.desk.call('profiles:settings', {id});
  proxyPasswordProvided = false;
  $('proxy-paste').value = ''; $('proxy-paste').setCustomValidity('');
  $('proxy-paste-hint').textContent = 'Paste all four parts at once. The fields below fill automatically.';
  settingsVersion = p.version; $('settings-folder').value = p.folder;
  $('settings-id').value = id; $('settings-name').value = p.name; $('settings-notes').value = p.notes;
  $('settings-url').value = p.startUrl === 'about:blank' ? '' : p.startUrl;
  $('proxy-mode').value = p.proxy.mode === 'blocked' ? 'http' : p.proxy.mode;
  $('proxy-host').value = p.proxy.host || ''; $('proxy-port').value = p.proxy.port || '';
  $('proxy-user').value = p.proxy.username || ''; $('proxy-pass').value = '';
  $('proxy-pass').placeholder = p.proxy.hasPassword ? 'Leave blank to keep saved password' : 'Proxy password';
  $('proxy-fields').hidden = $('proxy-mode').value === 'direct'; $('settings-dialog').showModal();
}
function updateSelection() {const count = document.querySelectorAll('.remote-check:checked').length; $('selection-count').textContent = `${count} selected`; $('import-selected').disabled = !count || importBusy;}
function renderRemotes() {
  $('remote-list').replaceChildren(); $('select-all').checked = false;
  if (!remotes.length) $('remote-list').append(element('p', 'hint', 'No profiles returned for this account.'));
  for (const [index, p] of remotes.entries()) {
    const row = element('div', 'remote-row'), check = element('input', 'remote-check');
    check.type = 'checkbox'; check.value = p.id; check.id = `remote-${index}`; check.disabled = p.imported || importBusy;
    check.addEventListener('change', updateSelection);
    const label = element('label', '', p.name); label.htmlFor = check.id; row.append(check, label);
    if (p.imported) row.append(element('span', '', 'Already imported')); $('remote-list').append(row);
  } updateSelection();
}
$('nav-profiles').onclick = () => {selectedFolder = '';view('profiles');render();}; $('nav-import').onclick = $('empty-import').onclick = () => view('import');
$('search').oninput = render;
$('new-profile').onclick = () => {$('profile-name').value = ''; $('profile-folder').value = selectedFolder; $('new-dialog').showModal(); $('profile-name').focus();};
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
$('create-form').onsubmit = event => {event.preventDefault(); perform(async () => {await window.desk.call('profiles:create', {name: $('profile-name').value, folder:$('profile-folder').value}); $('new-dialog').close(); await refresh(); toast('Profile created. Click Open to sign in.');});};
$('settings-form').onsubmit = event => {event.preventDefault(); perform(async () => {
  await window.desk.call('profiles:update', {id: $('settings-id').value, folder:$('settings-folder').value, version:settingsVersion, name: $('settings-name').value, notes: $('settings-notes').value, startUrl: $('settings-url').value,
    proxy: {mode: $('proxy-mode').value, host: $('proxy-host').value, port: $('proxy-port').value, username: $('proxy-user').value, password: $('proxy-pass').value, keepPassword: !proxyPasswordProvided && !$('proxy-pass').value}});
  $('settings-dialog').close(); await refresh(); toast('Settings saved.');
});};
$('proxy-mode').onchange = () => $('proxy-fields').hidden = $('proxy-mode').value === 'direct';
$('proxy-paste').oninput = () => {
  const input = $('proxy-paste'), value = input.value.trim();
  input.setCustomValidity('');
  if (!value) { $('proxy-paste-hint').textContent = 'Paste all four parts at once. The fields below fill automatically.'; return; }
  // Split only the first three separators so passwords may contain colons.
  const match = /^([a-zA-Z0-9.-]+):(\d+):([^:\r\n]*):([^\r\n]*)$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    const message = 'Use host:port:username:password, with a port from 1 to 65535.';
    input.setCustomValidity(message); $('proxy-paste-hint').textContent = message; return;
  }
  $('proxy-host').value = match[1]; $('proxy-port').value = String(Number(match[2]));
  $('proxy-user').value = match[3]; $('proxy-pass').value = match[4]; proxyPasswordProvided = true;
  if ($('proxy-mode').value === 'direct') $('proxy-mode').value = 'http';
  $('proxy-fields').hidden = false;
  $('proxy-paste-hint').textContent = 'Proxy filled in. Check the connection type, then Save settings.';
};
for (const id of ['proxy-host', 'proxy-port', 'proxy-user', 'proxy-pass']) {
  $(id).addEventListener('input', () => {
    if (id === 'proxy-pass') proxyPasswordProvided = true;
    $('proxy-paste').value = ''; $('proxy-paste').setCustomValidity('');
    $('proxy-paste-hint').textContent = 'Using the individual fields below.';
  });
}
$('settings-dialog').addEventListener('close', () => { $('proxy-paste').value = ''; $('proxy-pass').value = ''; });
$('connect-form').onsubmit = event => {event.preventDefault(); perform(async () => {
  $('connect-button').disabled = true; $('connect-button').textContent = 'Loading…'; $('remote-section').hidden = true; $('connect-error').hidden = true;
  try {remotes = await window.desk.call('gologin:connect', {token: $('token').value}); $('token').value = ''; renderRemotes(); $('remote-section').hidden = false; toast(`${remotes.length} profiles found.`);}
  catch (err) {$('connect-error').textContent = err.message; $('connect-error').hidden = false;}
  finally {$('connect-button').disabled = false; $('connect-button').textContent = 'Load profiles';}
});};
$('disconnect').onclick = () => perform(async () => {await window.desk.call('gologin:disconnect'); remotes = []; $('remote-section').hidden = true; $('token').value = ''; toast('Disconnected. API token forgotten.');});
$('select-all').onchange = () => {document.querySelectorAll('.remote-check:not(:disabled)').forEach(c => c.checked = $('select-all').checked); updateSelection();};
$('import-selected').onclick = () => perform(async () => {
  const ids = [...document.querySelectorAll('.remote-check:checked')].map(c => c.value);
  importBusy = true; $('import-selected').disabled = true; $('connect-button').disabled = true; $('disconnect').disabled = true; $('select-all').disabled = true;
  document.querySelectorAll('.remote-check').forEach(c => c.disabled = true); $('import-progress').textContent = 'Importing profiles…'; $('import-results').textContent = '';
  try {
    const results = await window.desk.call('gologin:import', {ids});
    const imported = new Set(results.filter(r => r.status !== 'failed').map(r => r.id));
    remotes.forEach(p => {if (imported.has(p.id)) p.imported = true;});
    $('import-results').textContent = results.map(r => `${r.status === 'imported' ? '✓' : r.status === 'failed' ? '!' : '—'} ${r.name}: ${r.message || 'Imported locally'}`).join('\n');
    $('import-progress').textContent = `${results.filter(r => r.status === 'imported').length} profiles imported. Review each profile’s report before opening.`;
    await refresh();
  } finally {importBusy = false; $('connect-button').disabled = false; $('disconnect').disabled = false; $('select-all').disabled = false; renderRemotes();}
});
$('reveal').onclick = () => perform(() => window.desk.call('data:reveal'));
window.desk.onProfiles(() => perform(refresh));
window.desk.onProgress(p => $('import-progress').textContent = `Imported ${p.completed} of ${p.total} · ${p.name}`);
perform(refresh);

let updateState;
function showUpdate(state) {
  updateState = state;
  const busy = ['checking','downloading','verifying','preparing'].includes(state.status);
  const titles = {idle:'Automatic updates enabled',checking:'Checking for updates…',downloading:'Step 1 of 4 · Downloading',verifying:'Step 2 of 4 · Verifying',preparing:'Step 3 of 4 · Preparing',ready:'Step 4 of 4 · Ready to restart',current:'You’re up to date',error:'Update needs attention',unavailable:'Development build'};
  const title = titles[state.status] || 'App update';
  const bytes = n => `${(n / 1000000).toFixed(1)} MB`;
  const transfer = state.status === 'downloading' && state.total > 0 ? `${state.progress ?? 0}% · ${bytes(state.downloaded || 0)} of ${bytes(state.total)}` : '';
  $('app-version').textContent = `v${state.version}`;
  $('update-summary').textContent = title;
  $('update-status').textContent = transfer || (state.status === 'ready' ? 'Close profiles, then restart below.' : state.status === 'error' ? 'Open details to retry.' : busy ? 'You can keep using the app.' : 'Checks automatically every four hours.');
  $('check-updates').textContent = state.status === 'ready' ? 'Restart to update' : busy ? 'View update progress' : state.status === 'error' ? 'View update details' : 'Check for updates';
  $('check-updates').disabled = false;
  $('update-version-detail').textContent = state.targetVersion ? `Version ${state.version} → ${state.targetVersion}` : `Installed version ${state.version}`;
  $('update-detail-title').textContent = title;
  $('update-detail-status').textContent = [transfer, state.message].filter(Boolean).join(' — ');
  for (const id of ['update-progress','update-detail-progress']) {
    const bar = $(id);bar.hidden = !['downloading','verifying','preparing'].includes(state.status);
    if (state.status === 'downloading' && Number.isFinite(state.progress)) bar.value = state.progress;
    else bar.removeAttribute('value');
  }
  const stages = ['downloading','verifying','preparing','ready'];
  const index = stages.indexOf(state.status);
  document.querySelectorAll('[data-update-step]').forEach((row,i) => {
    row.className = index > i ? 'complete' : index === i ? 'current' : '';
    row.querySelector('span').textContent = index > i ? '✓' : String(i + 1);
    if (index === i) row.setAttribute('aria-current','step'); else row.removeAttribute('aria-current');
  });
  $('update-action').hidden = !['ready','error'].includes(state.status);
  $('update-action').textContent = state.status === 'ready' ? 'Restart to update' : 'Try again';
}
function openUpdateDetails() {if (!$('update-dialog').open) $('update-dialog').showModal();}
$('check-updates').onclick = () => perform(async () => {
  openUpdateDetails();
  if (!['checking','downloading','verifying','preparing','ready','error'].includes(updateState?.status)) showUpdate(await window.desk.call('updates:check'));
});
$('update-action').onclick = () => perform(async () => {
  $('update-action').disabled = true;
  try {
    if (updateState?.status === 'ready') {
      await window.desk.call('updates:install');
      $('update-detail-status').textContent = 'Restarting now. Ortus Profile Desk will reopen automatically.';
    } else showUpdate(await window.desk.call('updates:check'));
  } finally {$('update-action').disabled = false;}
});
window.desk.onUpdates(showUpdate);
perform(async () => showUpdate(await window.desk.call('updates:status')));

$('sync-profiles').onclick = () => perform(async () => {await window.desk.call('workspace:refresh');await refresh();});

$('connect-workspace').onclick = () => {$('workspace-key').value = ''; $('workspace-dialog').showModal(); $('workspace-key').focus();};
$('workspace-dialog').addEventListener('close', () => {$('workspace-key').value = '';});
$('workspace-form').onsubmit = event => {event.preventDefault();perform(async () => {
  $('workspace-connect-submit').disabled = true;
  try {
    await window.desk.call('workspace:connect', {key:$('workspace-key').value});
    $('workspace-key').value = ''; $('workspace-dialog').close();await refresh();toast('Shared profiles and proxies loaded.');
  } finally {$('workspace-connect-submit').disabled = false;}
});};
