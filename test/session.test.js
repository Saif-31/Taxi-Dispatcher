import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSessionHandler } from '../api/session.js';
import { createMemoryLimiter } from '../lib/session-limiter.js';

const token = 'test-only-access-token-at-least-32-characters';
const env = { NODE_ENV: 'production', SESSION_ALLOWED_ORIGINS: 'https://taxi.example', SESSION_ACCESS_TOKEN: token, OPENAI_API_KEY: 'server-only-test-key' };
function setup(options = {}) {
  const calls = [];
  const limiter = options.limiter || { durable: true, consume: async () => ({ allowed: true, retryAfterSeconds: 3600 }) };
  const handler = createSessionHandler({ env: { ...env, ...options.env },
    getLimiter: options.getLimiter || (() => limiter),
    fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ id: 'session', client_secret: { value: 'ephemeral', expires_at: 123 } }) }; },
  });
  return { calls, async request(method = 'POST', headers = {}) {
    const res = { headers: {}, statusCode: 200, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
    await handler({ method, headers: { origin: 'https://taxi.example', authorization: `Bearer ${token}`, ...headers } }, res);
    return res;
  } };
}
for (const origin of ['https://evil.example', 'null', undefined, 'https://taxi.example.evil.test', 'https://taxi.example/', ['https://taxi.example'], 'http://localhost:3000']) {
  test(`blocks origin ${JSON.stringify(origin)}`, async () => {
    const s = setup(); const res = await s.request('POST', { origin });
    assert.equal(res.statusCode, 403); assert.equal(res.headers['Access-Control-Allow-Origin'], undefined); assert.equal(s.calls.length, 0);
  });
}
test('valid preflight requires no auth, quota or OpenAI configuration', async () => {
  const s = setup({ env: { SESSION_ACCESS_TOKEN: '', OPENAI_API_KEY: '' }, getLimiter: () => { throw Error('must not run'); } });
  const r = await s.request('OPTIONS', { authorization: undefined, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Authorization, Content-Type' });
  assert.equal(r.statusCode, 204); assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://taxi.example'); assert.equal(r.headers.Vary, 'Origin'); assert.equal(s.calls.length, 0);
});
test('preflight blocks bad origins, methods and headers', async () => {
  const s = setup();
  assert.equal((await s.request('OPTIONS', { origin: 'https://evil.example', 'access-control-request-method': 'POST' })).statusCode, 403);
  assert.equal((await s.request('OPTIONS', { 'access-control-request-method': 'DELETE' })).statusCode, 405);
  assert.equal((await s.request('OPTIONS', { 'access-control-request-method': 'POST', 'access-control-request-headers': 'X-Whatever' })).statusCode, 403);
  assert.equal(s.calls.length, 0);
});
for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) test(`rejects ${method}`, async () => {
  const s = setup(); const r = await s.request(method); assert.equal(r.statusCode, 405); assert.equal(r.headers.Allow, 'POST, OPTIONS'); assert.equal(s.calls.length, 0);
});
for (const config of [{ SESSION_ALLOWED_ORIGINS: '' }, { SESSION_ALLOWED_ORIGINS: '*' }, { SESSION_ALLOWED_ORIGINS: 'https://taxi.example/path' }, { SESSION_ACCESS_TOKEN: '' }, { SESSION_ACCESS_TOKEN: 'short' }, { OPENAI_API_KEY: '' }]) test(`missing/invalid configuration ${Object.keys(config)}`, async () => {
  const s = setup({ env: config }); assert.equal((await s.request()).statusCode, 503); assert.equal(s.calls.length, 0);
});
test('missing or wrong authentication cannot consume quota', async () => {
  const s = setup({ getLimiter: () => { throw Error('must not run'); } });
  for (const authorization of [undefined, 'Bearer wrong', `Basic ${token}`]) assert.equal((await s.request('POST', { authorization })).statusCode, 401);
  assert.equal(s.calls.length, 0);
});
test('default deployment without a durable adapter fails closed', async () => {
  const { getSessionLimiter } = await import('../lib/session-limiter.js');
  const s = setup({ getLimiter: getSessionLimiter, env: { SESSION_LIMITER_MODE: 'memory' } });
  assert.equal((await s.request()).statusCode, 503); assert.equal(s.calls.length, 0);
});
test('non-durable, broken and malformed adapters fail closed', async () => {
  for (const limiter of [createMemoryLimiter(), { durable: true, consume: async () => { throw Error('offline'); } }, { durable: true, consume: async () => ({ allowed: true }) }]) {
    const s = setup({ limiter }); assert.equal((await s.request()).statusCode, 503); assert.equal(s.calls.length, 0);
  }
});
test('shared adapter enforces quota across handlers and spoofed IPs, then resets', async () => {
  let time = 0;
  // Test double only: this does NOT establish that memory is production durable.
  const limiter = { ...createMemoryLimiter({ now: () => time }), durable: true };
  const a = setup({ limiter }), b = setup({ limiter });
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 2 ? a : b).request('POST', { 'x-forwarded-for': `spoof-${i}` })));
  assert.equal(results.filter(r => r.statusCode === 200).length, 10);
  assert.equal(results.filter(r => r.statusCode === 429).length, 5);
  assert.equal(results.find(r => r.statusCode === 429).headers['Retry-After'], '3600');
  assert.equal(a.calls.length + b.calls.length, 10);
  time = 3600000; assert.equal((await a.request()).statusCode, 200);
});
test('explicit local development works without auth using development memory', async () => {
  const { getSessionLimiter } = await import('../lib/session-limiter.js');
  const s = setup({ env: { NODE_ENV: 'development', SESSION_ALLOWED_ORIGINS: '', SESSION_ACCESS_TOKEN: '', SESSION_LIMITER_MODE: 'memory' }, getLimiter: getSessionLimiter });
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://[::1]:3000']) assert.equal((await s.request('POST', { origin, authorization: undefined })).statusCode, 200);
  assert.equal((await s.request('POST', { origin: 'http://localhost.evil.test' })).statusCode, 403);
});
test('preview deployments cannot activate local development bypass', async () => {
  const s = setup({ env: { NODE_ENV: 'development', VERCEL_ENV: 'preview', SESSION_ACCESS_TOKEN: '' } });
  assert.equal((await s.request('POST', { origin: 'http://localhost:3000' })).statusCode, 403);
});
test('response contains only ephemeral credentials; server key is upstream only', async () => {
  const s = setup(); const r = await s.request(); assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { client_secret: 'ephemeral', session_id: 'session', expires_at: 123 });
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(s.calls[0][1].headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
  assert.ok(!JSON.stringify(r).includes(env.OPENAI_API_KEY));
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(!app.includes('OPENAI_API_KEY')); assert.ok(app.includes('Authorization: `Bearer ${accessToken}`'));
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.headers, undefined);
});
