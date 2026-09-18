class TeamClient {
  constructor(store, config, active = new Map(), changed = () => {}) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' && !(config.testing && url.hostname === '127.0.0.1')) throw new Error('The shared workspace requires HTTPS.');
    if (url.username || url.password || !config.token || config.token.length < 32) throw new Error('Invalid workspace configuration.');
    this.store = store; this.config = config; this.active = active; this.changed = changed;
    this.status = {enabled:true, online:false, message:'Connecting to the shared workspace…'};
    this.revision = null; this.refreshing = null;
  }
  async request(route, options = {}) {
    let response;
    try {response = await fetch(this.config.baseUrl + route, {...options, redirect:'error', signal:AbortSignal.timeout(20000), headers:{Authorization:`Bearer ${this.config.token}`, 'Content-Type':'application/json', ...options.headers}});}
    catch {throw new Error('Cannot reach the shared workspace. Your saved profiles are retained. Check your connection and try again.');}
    if (response.status === 304) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(response.status === 401 ? 'Workspace access expired. Install the latest private team build.' : (body.error || 'The shared workspace could not complete this request.'));
    }
    return response.json();
  }
  merge(p) {
    if (!p || !/^[a-f0-9-]{36}$/.test(p.id) || typeof p.name !== 'string' || !p.proxy) throw new Error('The shared workspace returned an invalid profile.');
    let local = this.store.data.profiles.find(v => v.id === p.id);
    const fields = {id:p.id,name:p.name,notes:p.notes || '',folder:p.folder || 'Unassigned',email:p.email || '',proxy:p.proxy,startUrl:p.startUrl,createdAt:p.createdAt,shared:true,remoteVersion:p.version,sourceKey:p.sourceKey,archived:false};
    if (local && this.active.has(p.id)) return;
    if (local) Object.assign(local,fields);
    else {local = {...fields,cookies:[],cookieImport:{status:'none'}};this.store.data.profiles.push(local);}
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const result = await this.request('/profiles', {headers:this.revision === null ? {} : {'If-None-Match':String(this.revision)}});
        if (result) {
          const before = structuredClone(this.store.data);
          try {
            const ids = new Set(result.profiles.map(p => p.id));
            for (const p of this.store.data.profiles) if (p.shared && !ids.has(p.id) && !this.active.has(p.id)) p.archived = true;
            for (const p of result.profiles) this.merge(p);
            this.store.save();
          } catch (err) {this.store.data = before;throw err;}
          // Active profiles are refreshed after closing; do not mark their revision as consumed.
          this.revision = this.active.size ? null : result.revision;
          this.status = {...this.status, count:result.profiles.length, sheet:result.sheet};
        }
        this.status = {...this.status, online:true, message:'Profiles and proxy settings are shared. Browser sessions stay on this Mac.',lastChecked:new Date().toISOString()};
      } catch (error) {this.status = {...this.status,online:false,message:error.message};throw error;}
      finally {this.changed();this.refreshing = null;}
      return this.status;
    })();
    return this.refreshing;
  }
  async create(input) {
    const p = await this.request('/profiles', {method:'POST', body:JSON.stringify(input)});
    this.merge(p); this.store.save(); this.revision=null; this.changed(); return p;
  }
  async update(id, input, version) {
    const p = await this.request(`/profiles/${id}`, {method:'PUT',body:JSON.stringify({...input,version})});
    this.merge(p); this.store.save(); this.revision=null;this.changed();return p;
  }
  async beforeOpen(id) {
    if (this.active.has(id)) return;
    const p = await this.request(`/profiles/${id}`);
    if (p.archived) throw new Error('This account is no longer active in the spreadsheet.');
    this.merge(p);this.store.save();
  }
}
module.exports = {TeamClient};
