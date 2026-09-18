const SUPPORTED_PROXY_MODES = new Set(['http', 'https', 'socks5', 'socks4']);

function normalizeCookies(input, now = Date.now() / 1000) {
  if (!Array.isArray(input)) throw new Error('GoLogin returned an unexpected cookie format. Nothing was imported.');
  const cookies = [], skipped = [];
  for (const [index, c] of input.entries()) {
    if (!c || typeof c.name !== 'string' || typeof c.value !== 'string' ||
        typeof c.domain !== 'string' || !/^\.?[a-zA-Z0-9._-]+$/.test(c.domain)) {
      skipped.push({index, reason: 'Invalid cookie fields'}); continue;
    }
    if (c.partitionKey || c.partitioned) {
      skipped.push({index, reason: 'Partitioned cookie requires origin information'}); continue;
    }
    const expiration = Number(c.expirationDate ?? c.expires);
    if (!c.session && Number.isFinite(expiration) && expiration > 0 && expiration <= now) {
      skipped.push({index, reason: 'Expired'}); continue;
    }
    const cookie = {name: c.name, value: c.value, domain: c.hostOnly ? c.domain.replace(/^\./, '') : c.domain,
      path: typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/',
      secure: Boolean(c.secure), httpOnly: Boolean(c.httpOnly)};
    const sameSite = {strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None'}[String(c.sameSite).toLowerCase()];
    if (sameSite) cookie.sameSite = sameSite;
    if (!c.session && Number.isFinite(expiration) && expiration > 0) cookie.expires = expiration;
    cookies.push(cookie);
  }
  return {cookies, skipped};
}

function normalizeProxy(source) {
  const p = source.proxy || {};
  const mode = String(p.mode || '').toLowerCase();
  if (source.proxyEnabled === false || mode === 'none' || mode === 'direct') return {mode: 'direct'};
  if (!mode && !source.proxyEnabled && !source.autoProxyServer && !p.host) return {mode: 'direct'};
  if (!SUPPORTED_PROXY_MODES.has(mode) || /gologin/i.test(p.host || '')) {
    return {mode: 'blocked', reason: 'This profile uses a GoLogin-managed or unsupported proxy. Add an independent proxy before opening.'};
  }
  try { return validateProxy(p); }
  catch { return {mode: 'blocked', reason: 'Proxy settings are incomplete. Add a valid independent proxy before opening.'}; }
}

function validateProxy(p) {
  if (!p || p.mode === 'direct') return {mode: 'direct'};
  if (!SUPPORTED_PROXY_MODES.has(p.mode)) throw new Error('Choose a supported proxy type.');
  if (typeof p.host !== 'string' || !/^[a-zA-Z0-9.:-]+$/.test(p.host.trim())) throw new Error('Enter a valid proxy hostname or IP address.');
  const port = Number(p.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Proxy port must be between 1 and 65535.');
  if ((p.mode === 'socks4' || p.mode === 'socks5') && (p.username || p.password)) throw new Error('Authenticated SOCKS proxies are not supported yet. Use an HTTP(S) proxy or an IP-authorized SOCKS proxy.');
  return {mode: p.mode, host: p.host.trim(), port, username: String(p.username || ''), password: String(p.password || '')};
}

function safeStartUrl(value) {
  if (!value) return 'about:blank';
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch {}
  return 'about:blank';
}

function migrationReport(source, cookies) {
  const proxy = normalizeProxy(source);
  return {
    cookieCount: cookies.cookies.length,
    skippedCookies: cookies.skipped,
    importedAt: new Date().toISOString(),
    notes: [
      'Available cookies and profile configuration were saved locally. Cookie installation is checked on first open.',
      'GoLogin fingerprint settings are archived for reference. Chrome uses its own browser identity; identical fingerprints are not supported.',
      'Passwords, history, extensions, local storage, IndexedDB, and device-bound login tokens are not transferred by this importer. Some websites will require login again.',
      ...(proxy.mode === 'blocked' ? [proxy.reason] : proxy.mode !== 'direct' ? ['Confirm your proxy subscription is independent of GoLogin before cancelling GoLogin.'] : ['This profile uses your Mac’s current internet connection.'])
    ]
  };
}

function normalizeToken(value) {
  if (typeof value !== 'string') throw new Error('Enter your GoLogin API token from API & MCP.');
  let token = value.trim();
  const unquote = text => ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) ? text.slice(1, -1).trim() : text;
  token = unquote(token).replace(/^Authorization:\s*/i, '').replace(/^Bearer\s+/i, '').trim();
  token = unquote(token);
  if (/^[^:\s]+:\d+:[^:\r\n]*:[^\r\n]*$/.test(token)) throw new Error('That looks like a proxy, not a GoLogin API token. Paste proxies in profile settings. For importing, create a token in GoLogin’s API & MCP section.');
  if (!token || /\s/.test(token)) throw new Error('Paste one complete GoLogin API token from API & MCP.');
  return token;
}

class GoLoginAPI {
  constructor(token, fetchImpl = fetch) {
    this.token = normalizeToken(token); this.fetch = fetchImpl;
  }
  async get(path) {
    const response = await this.fetch(`https://api.gologin.com${path}`, {
      headers: {Authorization: `Bearer ${this.token}`}, redirect: 'error', signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('GoLogin rejected this token (HTTP 401). Create a new token in GoLogin → API & MCP for the account that owns your profiles, then paste it here.');
      if (response.status === 403) throw new Error('GoLogin refused access (HTTP 403). Check this account’s API and workspace permissions. If those are correct, contact GoLogin with this status code; their service may be blocking the request.');
      if (response.status === 429) throw new Error('GoLogin’s API rate limit was reached (HTTP 429). Stop and check your token in GoLogin before retrying.');
      throw new Error(`GoLogin request failed (HTTP ${response.status}). Try again later.`);
    }
    return response.json();
  }
  async list() {
    const found = new Map();
    for (let page = 1; page <= 1000; page++) {
      const data = await this.get(`/browser/v2?page=${page}`);
      if (!Array.isArray(data.profiles)) throw new Error('GoLogin returned an unexpected profile list.');
      if (!data.profiles.length) return [...found.values()];
      let added = 0;
      for (const p of data.profiles) if (typeof p.id === 'string' && !found.has(p.id)) { found.set(p.id, {id: p.id, name: String(p.name || 'Untitled profile')}); added++; }
      if (Number.isFinite(data.allProfilesCount) && found.size >= data.allProfilesCount) return [...found.values()];
      if (!added) throw new Error('GoLogin repeated a page; the profile list may be incomplete. Please retry.');
    }
    throw new Error('Too many profile pages. Import a smaller workspace.');
  }
  async profile(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('Invalid profile ID.');
    const source = await this.get(`/browser/${encodeURIComponent(id)}`);
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Unexpected profile settings.');
    const rawCookies = await this.get(`/browser/${encodeURIComponent(id)}/cookies`);
    const normalized = normalizeCookies(rawCookies);
    return {source, cookies: normalized.cookies, proxy: normalizeProxy(source), report: migrationReport(source, normalized)};
  }
}
module.exports = {normalizeCookies, normalizeProxy, validateProxy, safeStartUrl, migrationReport, normalizeToken, GoLoginAPI};
