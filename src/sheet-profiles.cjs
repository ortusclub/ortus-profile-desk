const {createHash} = require('node:crypto');
const {validateProxy} = require('./migration.cjs');

function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {field += '"'; i++;}
      else if (quoted || !field) quoted = !quoted;
      else throw new Error('Malformed CSV quoting in the sheet.');
    } else if (ch === ',' && !quoted) {row.push(field); field = '';}
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('The sheet CSV ends inside a quoted field.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

function sheetLocation(input) {
  let url; try {url = new URL(input);} catch {throw new Error('Enter a Google Sheets URL.');}
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password) throw new Error('Use a docs.google.com spreadsheet URL.');
  const id = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1];
  const gid = url.searchParams.get('gid') || new URLSearchParams(url.hash.slice(1)).get('gid');
  if (!id || !gid || !/^\d+$/.test(gid)) throw new Error('Open the account tab in Google Sheets and copy its URL, including gid.');
  return {id, gid, exportUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`};
}

function accountRows(csv, source) {
  const rows = parseCSV(csv);
  const headings = (rows.shift() || []).map(v => v.trim().toLowerCase());
  const required = ['email', 'status', 'vm account'];
  if (required.some(h => !headings.includes(h))) throw new Error('This tab must contain Email, Status and VM Account columns.');
  for (const h of required) if (headings.indexOf(h) !== headings.lastIndexOf(h)) throw new Error(`Duplicate ${h} columns make this sheet ambiguous.`);
  const get = (row, name) => String(row[headings.indexOf(name)] || '').trim();
  const seen = new Set(), profiles = [], inactiveKeys = new Set();
  const sourcePrefix = createHash('sha256').update(`${source.id}:${source.gid}`).digest('hex').slice(0, 24);
  for (const row of rows) {
    const email = get(row, 'email').toLowerCase();
    const status = get(row, 'status').toLowerCase();
    if (!email && status !== 'active') continue;
    if (!email) throw new Error('An active row has no email. No profile changes were applied.');
    const sourceKey = `sheet:${sourcePrefix}:${createHash('sha256').update(email).digest('hex')}`;
    if (status !== 'active') {inactiveKeys.add(sourceKey); continue;}
    if (seen.has(email)) throw new Error('Two active rows have the same email. Resolve the duplicate before syncing.');
    seen.add(email);
    const name = email;
    const rawProxy = get(row, 'proxy details');
    let proxy = {mode: 'direct'};
    if (rawProxy) {
      const match = /^([a-zA-Z0-9.-]+):(\d+):([^:\r\n]*):([^\r\n]*)$/.exec(rawProxy);
      try {
        if (!match) throw new Error('Unsupported proxy format');
        proxy = validateProxy({mode: 'http', host: match[1], port: match[2], username: match[3], password: match[4]});
      } catch {proxy = {mode: 'blocked', reason: 'The spreadsheet proxy needs attention. Enter a valid proxy in profile settings.'};}
    }
    profiles.push({sourceKey, sourcePrefix, email, name, folder: get(row, 'vm account') || 'Unassigned', proxy,
      startUrl: 'https://www.linkedin.com/', sheetActive: true});
  }
  // A stale inactive duplicate must never override an active row for the same account.
  profiles.forEach(p => inactiveKeys.delete(p.sourceKey));
  return {profiles, inactiveKeys: [...inactiveKeys], sourcePrefix,
    summary: {active: profiles.length, folders: Object.fromEntries(profiles.reduce((m,p) => m.set(p.folder, (m.get(p.folder) || 0) + 1), new Map()))}};
}

module.exports = {parseCSV, sheetLocation, accountRows};
