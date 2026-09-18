const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validateProxy, safeStartUrl} = require('../src/migration.cjs');
const {accountRows, sheetLocation} = require('../src/sheet-profiles.cjs');
const fail = (status, message) => Object.assign(new Error(message), {status});
class Database {
  constructor(root, key) {
    this.root = root; this.key = Buffer.from(key, 'hex');
    if (this.key.length !== 32) throw new Error('A 32-byte storage key is required.');
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    fs.mkdirSync(path.join(root, 'snapshots'), {recursive: true, mode: 0o700});
    this.file = path.join(root, 'catalog.vault');
    this.data = fs.existsSync(this.file) ? JSON.parse(this.decrypt(fs.readFileSync(this.file))) : {revision: 0, profiles: [], locks: {}, sheet: {}};
  }
  encrypt(input) {const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv); const body = Buffer.concat([cipher.update(input), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]);}
  decrypt(input) {const c = crypto.createDecipheriv('aes-256-gcm', this.key, input.subarray(0, 12)); c.setAuthTag(input.subarray(12,28)); return Buffer.concat([c.update(input.subarray(28)), c.final()]);}
  save() {
    const revision = this.data.revision;
    this.data.revision++;
    const temp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(temp, this.encrypt(Buffer.from(JSON.stringify(this.data))), {mode: 0o600});
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.previous`);
      fs.renameSync(temp, this.file);
    } catch (err) {
      this.data = fs.existsSync(this.file) ? JSON.parse(this.decrypt(fs.readFileSync(this.file))) : {revision,profiles:[],locks:{},sheet:{}};
      throw err;
    }
  }
  get(id) {const p = this.data.profiles.find(p => p.id === id); if (!p) throw fail(404, 'Profile not found.'); return p;}
  list() {return this.data.profiles.filter(p => !p.archived).map(p => {
    const {cookies, source, ...summary} = p;
    const lock = this.data.locks[p.id];
    return {...summary, lock: lock ? {owner: lock.owner, since: lock.since} : null};
  });}
  fields(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) throw fail(400, 'Enter a name of up to 160 characters.');
    for (const field of ['folder','notes','email']) if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > (field === 'notes' ? 10000 : 300))) throw fail(400, `Invalid ${field}.`);
    const startUrl = safeStartUrl(input.startUrl);
    if (input.startUrl && input.startUrl !== 'about:blank' && startUrl === 'about:blank') throw fail(400, 'Start page must be an HTTP or HTTPS address.');
    let proxy;
    try {proxy = input.proxy?.mode === 'blocked' ? {mode:'blocked',reason:'Proxy needs attention.'} : validateProxy(input.proxy || {mode:'direct'});} catch {throw fail(400,'Invalid proxy settings.');}
    return {name: input.name.trim(), folder: (input.folder || 'Unassigned').trim(), notes: input.notes || '', email: input.email || '', startUrl,
      proxy};
  }
  create(input) {
    if (input.sourceId && this.data.profiles.some(p => p.sourceId === input.sourceId)) throw fail(409, 'This GoLogin profile is already shared.');
    const p = {...this.fields(input), id: crypto.randomUUID(), version: 1, createdAt: new Date().toISOString(), snapshot: null};
    if (input.sourceId) {p.sourceId = String(input.sourceId).slice(0,120); p.cookies = Array.isArray(input.cookies) ? input.cookies : []; p.report = input.report; p.cookieImport = {status: 'pending'};}
    this.data.profiles.push(p); this.save(); return p;
  }
  update(id, input) {
    const p = this.get(id);
    if (this.data.locks[id]) throw fail(409, 'This profile is open. Close and sync it before editing settings.');
    if (input.version !== p.version) throw fail(409, 'Another Mac changed this profile. Refresh its settings and try again.');
    Object.assign(p, this.fields(input), {version: p.version + 1}); this.save(); return p;
  }
  acquire(id, owner, token) {
    const p = this.get(id);
    if (p.archived) throw fail(409, 'This profile is no longer active in the sheet.');
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(owner || '') || !/^[a-zA-Z0-9-]{20,100}$/.test(token || '')) throw fail(400, 'Invalid device lock.');
    const lock = this.data.locks[id];
    if (lock && (lock.owner !== owner || lock.token !== token)) throw fail(409, 'This profile is open on another Mac, or its last session has not finished syncing.');
    if (!lock) {this.data.locks[id] = {owner, token, since: new Date().toISOString()}; this.save();}
    return {...p};
  }
  checkLock(id, owner, token) {this.get(id); const l = this.data.locks[id]; if (!l || l.owner !== owner || l.token !== token) throw fail(409, 'Profile lock does not belong to this Mac.');}
  release(id, owner, token) {this.checkLock(id, owner, token); delete this.data.locks[id]; this.save();}
  commit(id, owner, token, snapshot) {
    this.checkLock(id, owner, token); const p = this.get(id);
    const previous = p.snapshot;
    p.snapshot = snapshot; p.version++; p.lastSaved = new Date().toISOString(); p.cookies = []; p.cookieImport = {status:'complete'};
    this.save();
    // Keep the immediately preceding snapshot as a recovery copy.
    if (p.previousSnapshot && p.previousSnapshot !== previous?.file) fs.rmSync(path.join(this.root, 'snapshots', p.previousSnapshot), {force:true});
    p.previousSnapshot = previous?.file; this.save();
    return p;
  }
  async syncSheet(url, fetchImpl = fetch) {
    const location = sheetLocation(url);
    const response = await fetchImpl(location.exportUrl, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Sheet fetch failed (HTTP ${response.status}).`);
    const csv = await response.text();
    if (csv.length > 20 * 1024 * 1024) throw new Error('Sheet exceeds size limit.');
    const parsed = accountRows(csv, location);
    if (!parsed.profiles.length) throw new Error('Sheet returned no active accounts; keeping the previous catalog for review.');
    const active = new Set(parsed.profiles.map(p => p.sourceKey));
    for (const row of parsed.profiles) {
      const proxyHash = crypto.createHash('sha256').update(JSON.stringify(row.proxy)).digest('hex');
      let p = this.data.profiles.find(p => p.sourceKey === row.sourceKey);
      if (!p) {
        p = {...row, id: crypto.randomUUID(), version: 1, notes: '', createdAt: new Date().toISOString(), snapshot: null, sheetProxyHash: proxyHash};
        this.data.profiles.push(p);
      } else if (!this.data.locks[p.id]) {
        if (p.name !== row.name || p.folder !== row.folder || p.archived || p.sheetProxyHash !== proxyHash) {
          p.name = row.name; p.folder = row.folder; p.email = row.email; p.archived = false;
          if (p.sheetProxyHash !== proxyHash) p.proxy = row.proxy;
          p.sheetProxyHash = proxyHash; p.version++;
        }
      }
    }
    for (const p of this.data.profiles) if (p.sourcePrefix === parsed.sourcePrefix && !active.has(p.sourceKey) && !this.data.locks[p.id]) p.archived = true;
    this.data.sheet = {lastSynced: new Date().toISOString(), ...parsed.summary}; this.save();
    return parsed.summary;
  }
}
module.exports = {Database, fail};
