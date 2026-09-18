const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
class Store {
  constructor(root, encryption) {
    this.root = root; this.encryption = encryption;
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    fs.chmodSync(root, 0o700);
    this.file = path.join(root, 'profiles.vault');
    this.data = {version: 1, profiles: []};
    if (fs.existsSync(this.file)) {
      try { this.data = JSON.parse(encryption.decryptString(fs.readFileSync(this.file))); }
      catch { throw new Error('Profile Desk could not unlock its data. Your existing vault has not been changed. Check macOS Keychain access and reopen the app.'); }
      if (this.data.version !== 1 || !Array.isArray(this.data.profiles)) throw new Error('Unsupported profile vault format.');
    }
  }
  save() {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, this.encryption.encryptString(JSON.stringify(this.data)), {mode: 0o600});
    fs.renameSync(temp, this.file);
  }
  get(id) {
    const p = this.data.profiles.find(p => p.id === id);
    if (!p) throw new Error('Profile not found.');
    return p;
  }
  directory(id) { this.get(id); return path.join(this.root, 'browsers', id); }
  add(profile) {
    if (profile.sourceId && this.data.profiles.some(p => p.sourceId === profile.sourceId)) throw new Error('This GoLogin profile is already imported. Its local session was kept.');
    const p = {...profile, id: randomUUID(), createdAt: new Date().toISOString()};
    this.data.profiles.push(p);
    try { this.save(); } catch (err) { this.data.profiles.pop(); throw err; }
    return p;
  }
  update(id, changes) {
    const p = this.get(id), before = {...p};
    Object.assign(p, changes);
    try { this.save(); } catch (err) { Object.keys(p).forEach(k => delete p[k]); Object.assign(p, before); throw err; }
    return p;
  }
  list(active = new Map()) {
    return this.data.profiles.filter(p => !p.archived || active.has(p.id)).map(p => ({id: p.id, name: p.name, folder: p.folder || 'Unassigned', email: p.email || '', shared: Boolean(p.shared), notes: p.notes || '', sourceId: p.sourceId,
      createdAt: p.createdAt, lastOpened: p.lastOpened, state: active.get(p.id)?.state || 'closed',
      proxyLabel: p.proxy.mode === 'direct' ? 'Direct connection' : p.proxy.mode === 'blocked' ? 'Proxy needs attention' : `${p.proxy.host}:${p.proxy.port}`,
      blocked: p.proxy.mode === 'blocked', report: p.report, cookieImport: p.cookieImport}));
  }
}
module.exports = {Store};
