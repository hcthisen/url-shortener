import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openMemoryDb, type DB } from '../src/db.js';
import type { Config } from '../src/config.js';

const config: Config = {
  appUrl: 'https://hct.gg',
  adminPassword: 'test-password',
  sessionSecret: 'test-session-secret',
  port: 0,
  dataDir: ':memory:',
  dev: false,
};

let app: FastifyInstance;
let db: DB;
let apiKey: string;
let sessionCookie: string;

beforeAll(async () => {
  db = openMemoryDb();
  app = await buildServer(config, db);

  const login = await app.inject({ method: 'POST', url: '/login', payload: { password: 'test-password' } });
  expect(login.statusCode).toBe(200);
  sessionCookie = login.cookies.find((c) => c.name === 'session')!.value;

  const keyRes = await app.inject({
    method: 'POST',
    url: '/api/keys',
    payload: { name: 'test key' },
    cookies: { session: sessionCookie },
  });
  expect(keyRes.statusCode).toBe(201);
  apiKey = keyRes.json().key;
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('auth', () => {
  it('rejects API requests without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/links' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('rejects a bad password and a bad API key', async () => {
    const bad = await app.inject({ method: 'POST', url: '/login', payload: { password: 'wrong' } });
    expect(bad.statusCode).toBe(401);
    const badKey = await app.inject({ method: 'GET', url: '/api/links', headers: { authorization: 'Bearer sk_nope' } });
    expect(badKey.statusCode).toBe(401);
  });

  it('accepts a valid API key and a valid session', async () => {
    const viaKey = await app.inject({ method: 'GET', url: '/api/links', headers: { authorization: `Bearer ${apiKey}` } });
    expect(viaKey.statusCode).toBe(200);
    const viaSession = await app.inject({ method: 'GET', url: '/api/links', cookies: { session: sessionCookie } });
    expect(viaSession.statusCode).toBe(200);
  });

  it('refuses key management with an API key (session only)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/keys', headers: { authorization: `Bearer ${apiKey}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('links API', () => {
  const auth = () => ({ authorization: `Bearer ${apiKey}` });

  it('creates a link with a generated code and mints on APP_URL', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'https://example.com/page' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toMatch(/^[1-9A-HJ-NP-Za-km-z]{6}$/);
    expect(body.shortUrl).toBe(`https://hct.gg/${body.code}`);
  });

  it('accepts a custom code once, then 409s', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'https://example.com', code: 'launch' } });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'https://example.com', code: 'launch' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('code_taken');
  });

  it('rejects reserved codes and invalid URLs', async () => {
    const reserved = await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'https://example.com', code: 'api' } });
    expect(reserved.statusCode).toBe(400);
    const badUrl = await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'notaurl' } });
    expect(badUrl.statusCode).toBe(400);
    const ftp = await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'ftp://example.com' } });
    expect(ftp.statusCode).toBe(400);
  });

  it('updates and deletes a link', async () => {
    await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'https://example.com/old', code: 'edit-me' } });
    const patch = await app.inject({ method: 'PATCH', url: '/api/links/edit-me', headers: auth(), payload: { url: 'https://example.com/new', note: 'hello' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().url).toBe('https://example.com/new');
    expect(patch.json().note).toBe('hello');
    const del = await app.inject({ method: 'DELETE', url: '/api/links/edit-me', headers: auth() });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url: '/api/links/edit-me', headers: auth() });
    expect(gone.statusCode).toBe(404);
  });

  it('serves a QR code as SVG', async () => {
    await app.inject({ method: 'POST', url: '/api/links', headers: auth(), payload: { url: 'https://example.com', code: 'qr-test' } });
    const res = await app.inject({ method: 'GET', url: '/api/links/qr-test/qr', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
  });
});

describe('redirects & tracking', () => {
  it('redirects a known code and records the click', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/links',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { url: 'https://example.com/target', code: 'go' },
    });
    const res = await app.inject({ method: 'GET', url: '/go', headers: { referer: 'https://twitter.com/x' } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/target');

    // click insert happens via setImmediate — wait a tick
    await new Promise((r) => setImmediate(r));
    const stats = await app.inject({ method: 'GET', url: '/api/links/go/stats?days=7', headers: { authorization: `Bearer ${apiKey}` } });
    expect(stats.statusCode).toBe(200);
    const body = stats.json();
    expect(body.totalClicks).toBe(1);
    expect(body.clicksByDay).toHaveLength(7);
    expect(body.clicksInRange).toBe(1);
    expect(body.topReferrers[0].referrer).toContain('twitter.com');
  });

  it('404s unknown codes', async () => {
    const res = await app.inject({ method: 'GET', url: '/definitely-not-a-code' });
    expect(res.statusCode).toBe(404);
  });

  it('supports the days parameter and clamps it', async () => {
    const stats = await app.inject({ method: 'GET', url: '/api/links/go/stats?days=30', headers: { authorization: `Bearer ${apiKey}` } });
    expect(stats.json().clicksByDay).toHaveLength(30);
    const clamped = await app.inject({ method: 'GET', url: '/api/stats?days=9999', headers: { authorization: `Bearer ${apiKey}` } });
    expect(clamped.json().days).toBe(365);
  });

  it('reports account-wide stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats', headers: { authorization: `Bearer ${apiKey}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(7);
    expect(body.totalLinks).toBeGreaterThan(0);
    expect(body.totalClicks).toBeGreaterThan(0);
    expect(body.clicksByDay).toHaveLength(7);
    expect(body.topLinks[0].code).toBe('go');
  });
});

describe('public endpoints', () => {
  it('serves health, openapi and llms.txt without auth', async () => {
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const spec = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().servers[0].url).toBe('https://hct.gg/api');

    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(llms.statusCode).toBe(200);
    expect(llms.body).toContain('https://hct.gg');

    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.body).toContain('scalar');
  });
});
