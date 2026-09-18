const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizeCookies, normalizeProxy, validateProxy, safeStartUrl, normalizeToken, GoLoginAPI} = require('../src/migration.cjs');
test('cookies retain scope and session attributes while expired and unsafe cookies are reported', () => {
  const result = normalizeCookies([
    {name: 'sid', value: 'secret', domain: '.example.com', hostOnly: true, secure: true, httpOnly: true, sameSite: 'no_restriction', session: true, expirationDate: 10},
    {name: 'long', value: 'v', domain: '.example.com', expirationDate: 200, path: '/app', sameSite: 'lax'},
    {name: 'old', value: 'v', domain: 'example.com', expirationDate: 10},
    {name: 'partition', value: 'v', domain: 'example.com', partitionKey: 'https://example.org'},
    {name: 'invalid', value: 'v', domain: 'https://bad.example/'}
  ], 100);
  assert.equal(result.cookies.length, 2); assert.equal(result.skipped.length, 3);
  assert.equal(result.cookies[0].domain, 'example.com'); assert.equal(result.cookies[0].sameSite, 'None');
  assert.equal(result.cookies[0].httpOnly, true); assert.equal(result.cookies[0].expires, undefined);
  assert.equal(result.cookies[1].domain, '.example.com'); assert.equal(result.cookies[1].path, '/app'); assert.equal(result.cookies[1].expires, 200);
  assert.throws(() => normalizeCookies({cookies: []}), /unexpected cookie format/);
});
test('managed and malformed proxies block opening rather than silently using a direct connection', () => {
  assert.equal(normalizeProxy({proxy: {mode: 'gologin'}}).mode, 'blocked');
  assert.equal(normalizeProxy({proxyEnabled: true}).mode, 'blocked');
  assert.equal(normalizeProxy({proxy: {mode: 'http', host: 'proxy.example', port: 'bad'}}).mode, 'blocked');
  assert.equal(normalizeProxy({proxy: {mode: 'http', host: 'proxy.example', port: '8080', username: 'a', password: 'b'}}).password, 'b');
  assert.equal(normalizeProxy({proxyEnabled: false}).mode, 'direct');
  assert.equal(normalizeProxy({proxy: {mode: 'socks5', host: 'proxy.example', port: 1080, username: 'user'}}).mode, 'blocked');
  assert.throws(() => validateProxy({mode: 'http', host: '--flag', port: 0}));
});
test('start URLs cannot open local files, scripts, or credential-bearing addresses', () => {
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com']) assert.equal(safeStartUrl(value), 'about:blank');
  assert.equal(safeStartUrl('https://example.com'), 'https://example.com/');
});
test('pagination deduplicates profiles and handles missing total count', async () => {
  const requests = [];
  const pages = [{profiles: [{id: 'a', name: 'One'}, {id: 'b', name: 'Two'}]}, {profiles: [{id: 'b', name: 'Two'}, {id: 'c', name: 'Three'}]}, {profiles: []}];
  const api = new GoLoginAPI('token', async (url, options) => {
    requests.push(url); assert.equal(options.headers.Authorization, 'Bearer token'); assert.equal(options.redirect, 'error');
    return {ok: true, json: async () => pages.shift()};
  });
  assert.deepEqual((await api.list()).map(p => p.id), ['a', 'b', 'c']); assert.equal(requests.length, 3);
});
test('API errors do not return response secrets, and invalid profile IDs never reach the network', async () => {
  let calls = 0;
  const api = new GoLoginAPI('secret', async () => {calls++; return {ok: false, status: 401};});
  await assert.rejects(api.profile('../secrets'), /Invalid profile ID/); assert.equal(calls, 0);
  await assert.rejects(api.list(), /HTTP 401/);
});
test('pasted tokens accept copied authorization prefixes and reject proxy strings locally', async () => {
  for (const input of [' example-token\n', 'Bearer example-token', 'Authorization: Bearer example-token', '"example-token"', "Bearer 'example-token'"]) assert.equal(normalizeToken(input), 'example-token');
  assert.throws(() => normalizeToken('192.0.2.1:8080:user:password'), /looks like a proxy/);
  assert.throws(() => normalizeToken('token\r\nInjected: value'), /complete GoLogin API token/);
  const api = new GoLoginAPI('Bearer example-token', async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer example-token');
    return {ok: false, status: 403};
  });
  await assert.rejects(api.list(), /HTTP 403/);
});
test('migration reads configuration and cookies without any remote mutations', async () => {
  const calls = [];
  const api = new GoLoginAPI('secret', async (url, options) => {
    assert.equal(options.method, undefined); calls.push(url);
    return {ok: true, json: async () => url.endsWith('/cookies') ? [] : {id: 'abc', name: 'Work', proxy: {mode: 'none'}, canvas: {mode: 'noise'}}};
  });
  const result = await api.profile('abc');
  assert.equal(calls.length, 2); assert.equal(result.source.canvas.mode, 'noise'); assert.equal(result.proxy.mode, 'direct');
  assert(result.report.notes.some(n => n.includes('identical fingerprints are not supported')));
});
