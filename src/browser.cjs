const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const proxyChain = require('proxy-chain');
const {safeStartUrl} = require('./migration.cjs');

function chromePath() {
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(require('node:os').homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Install Google Chrome to open profiles. Profile Desk uses a separate data folder for each profile.');
}

class BrowserManager {
  constructor(store, changed = () => {}) {this.store = store; this.changed = changed; this.active = new Map();}
  async open(id, options = {}) {
    const current = this.active.get(id);
    if (current) {
      if (current.browser && current.state === 'open') { const pages = await current.browser.pages(); await pages[0]?.bringToFront(); }
      return;
    }
    const profile = this.store.get(id);
    if (profile.proxy.mode === 'blocked') throw new Error(profile.proxy.reason);
    const executablePath = chromePath();
    const entry = {state: 'opening', browser: null, localProxy: null};
    this.active.set(id, entry); this.changed();
    try {
      const userDataDir = this.store.directory(id);
      fs.mkdirSync(userDataDir, {recursive: true, mode: 0o700});
      const args = ['--no-first-run', '--no-default-browser-check', '--restore-last-session'];
      if (profile.proxy.mode !== 'direct') {
        const p = profile.proxy;
        const host = p.host.includes(':') ? `[${p.host.replace(/^\[|\]$/g, '')}]` : p.host;
        let proxyUrl = `${p.mode}://${host}:${p.port}`;
        if (p.username || p.password) {
          proxyUrl = await proxyChain.anonymizeProxy(`${p.mode}://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@${host}:${p.port}`);
          entry.localProxy = proxyUrl;
        }
        args.push(`--proxy-server=${proxyUrl}`, '--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
      }
      entry.browser = await puppeteer.launch({executablePath, userDataDir, headless: options.headless ?? false,
        defaultViewport: null, pipe: true, timeout: 45000, args,
        // Do not disable Chrome security features or inject fingerprint spoofing scripts.
        ignoreDefaultArgs: ['--disable-extensions']});
      entry.browser.once('disconnected', () => { this.cleanup(id, entry).catch(() => {}); });
      if (profile.cookieImport?.status === 'pending') {
        const session = await entry.browser.target().createCDPSession();
        const failed = [];
        let imported = 0;
        for (const [index, cookie] of (profile.cookies || []).entries()) {
          try { await session.send('Storage.setCookies', {cookies: [cookie]}); imported++; }
          catch { failed.push(index); }
        }
        await session.detach();
        this.store.update(id, {cookieImport: {status: failed.length ? 'partial' : 'complete', imported, failed: failed.length, checkedAt: new Date().toISOString()},
          // Keep only rejected cookies for a future explicit retry, never replay old cookies on every launch.
          cookies: failed.map(index => profile.cookies[index])});
      }
      this.store.update(id, {lastOpened: new Date().toISOString()});
      entry.state = 'open'; this.changed();
      if (options.navigate !== false) {
        const pages = await entry.browser.pages();
        const page = pages[0] || await entry.browser.newPage();
        const startUrl = safeStartUrl(profile.startUrl);
        if (page.url() === 'about:blank' && startUrl !== 'about:blank') {
          // Leave navigation failures visible in Chrome; the browser itself still opened successfully.
          await page.goto(startUrl, {waitUntil: 'domcontentloaded', timeout: 20000}).catch(() => {});
        }
      }
      return entry.browser;
    } catch (error) {
      if (entry.browser) await entry.browser.close().catch(() => {});
      await this.cleanup(id, entry);
      if (/singleton|already running|user data directory/i.test(error.message)) throw new Error('This profile is already open in another browser process. Close that window before trying again.');
      throw error;
    }
  }
  async cleanup(id, entry) {
    if (entry.localProxy) { const url = entry.localProxy; entry.localProxy = null; await proxyChain.closeAnonymizedProxy(url, true).catch(() => {}); }
    if (this.active.get(id) === entry) { this.active.delete(id); this.changed(); }
  }
  async close(id) {
    const entry = this.active.get(id);
    if (!entry) return;
    if (!entry.browser || entry.state === 'opening') throw new Error('The profile is still opening. Wait a moment and try again.');
    entry.state = 'closing'; this.changed();
    try { await entry.browser.close(); await this.cleanup(id, entry); }
    catch (error) { entry.state = 'open'; this.changed(); throw error; }
  }
  async closeAll() { await Promise.all([...this.active.keys()].map(id => this.close(id))); }
}
module.exports = {BrowserManager, chromePath};
