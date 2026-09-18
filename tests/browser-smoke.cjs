// Real Chrome, isolated temporary profiles and a localhost-only test site.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {Server: ProxyServer} = require('proxy-chain');
const {Store} = require('../src/store.cjs');
const {BrowserManager} = require('../src/browser.cjs');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-desk-browser-'));
  const store = new Store(root, {encryptString: s => Buffer.from(s), decryptString: b => b.toString()});
  const browsers = new BrowserManager(store);
  const server = http.createServer((_req, res) => {res.end('<!doctype html><title>Profile Desk test</title>Local test');});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let proxy;
  try {
    const one = store.add({name: 'One', proxy: {mode: 'direct'}, cookies: [{name: 'imported', value: 'kept', domain: '127.0.0.1', path: '/', expires: Date.now()/1000+3600}], cookieImport: {status: 'pending'}});
    const two = store.add({name: 'Two', proxy: {mode: 'direct'}, cookies: [], cookieImport: {status: 'none'}});
    const browser = await browsers.open(one.id, {headless: true, navigate: false});
    const page = (await browser.pages())[0]; await page.goto(url);
    assert((await page.cookies()).some(c => c.name === 'imported' && c.value === 'kept'));
    await page.evaluate(() => {localStorage.setItem('identity', 'one'); document.cookie = 'session=remember; path=/';});
    assert.equal(store.get(one.id).cookieImport.status, 'complete');
    const other = await browsers.open(two.id, {headless: true, navigate: false});
    const otherPage = (await other.pages())[0]; await otherPage.goto(url);
    assert.equal(await otherPage.evaluate(() => localStorage.getItem('identity')), null);
    assert(!(await otherPage.cookies()).some(c => c.name === 'imported'));
    await browsers.close(one.id); await browsers.close(two.id);
    const reopened = await browsers.open(one.id, {headless: true, navigate: false});
    const reopenedPage = (await reopened.pages())[0]; await reopenedPage.goto(url);
    assert.equal(await reopenedPage.evaluate(() => localStorage.getItem('identity')), 'one');
    assert((await reopenedPage.cookies()).some(c => c.name === 'imported'));
    assert((await reopenedPage.cookies()).some(c => c.name === 'session'), 'Session cookies survive normal close and reopen');
    let authenticatedRequests = 0;
    proxy = new ProxyServer({host: '127.0.0.1', port: 0, prepareRequestFunction: ({username, password, request}) => {
      const authorized = username === 'test-user' && password === 'test-pass';
      if (authorized && request.url.includes('example.test')) authenticatedRequests++;
      return {requestAuthentication: !authorized, customResponseFunction: () => ({statusCode: 200, body: '<title>Proxy works</title>Proxy test'})};
    }});
    await proxy.listen();
    const proxied = store.add({name: 'Proxy test', proxy: {mode: 'http', host: '127.0.0.1', port: proxy.port, username: 'test-user', password: 'test-pass'}, cookies: [], cookieImport: {status: 'none'}});
    const proxyBrowser = await browsers.open(proxied.id, {headless: true, navigate: false});
    const proxyPage = (await proxyBrowser.pages())[0]; await proxyPage.goto('http://example.test/');
    assert.equal(await proxyPage.title(), 'Proxy works'); assert(authenticatedRequests > 0);
    console.log('PASS: real Chrome cookie import, profile isolation, local storage, session persistence and authenticated HTTP proxy.');
  } finally {await browsers.closeAll(); if (proxy) await proxy.close(true); server.close(); fs.rmSync(root, {recursive: true, force: true});}
})().catch(err => {console.error(err); process.exitCode = 1;});
