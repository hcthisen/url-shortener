import { describe, expect, it } from 'vitest';
import { generateCode, validateCustomCode } from '../src/codes.js';
import { isReserved, RESERVED_PATHS } from '../src/reserved.js';
import { createSessionToken, generateApiKey, hashApiKey, verifySessionToken } from '../src/auth.js';
import { clicksByDay } from '../src/stats.js';
import { openMemoryDb } from '../src/db.js';

describe('reserved paths', () => {
  it('rejects reserved segments regardless of case', () => {
    expect(isReserved('api')).toBe(true);
    expect(isReserved('API')).toBe(true);
    expect(isReserved('dashboard')).toBe(true);
    expect(isReserved('openapi.json')).toBe(true);
    expect(isReserved('my-link')).toBe(false);
  });

  it('never generates a reserved code', () => {
    for (let i = 0; i < 2000; i++) {
      expect(RESERVED_PATHS.has(generateCode())).toBe(false);
    }
  });
});

describe('code generation & validation', () => {
  it('generates 6-char base58 codes without ambiguous characters', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]{6}$/);
    }
  });

  it('validates custom codes', () => {
    expect(validateCustomCode('my-link_1').ok).toBe(true);
    expect(validateCustomCode('api').ok).toBe(false);
    expect(validateCustomCode('has space').ok).toBe(false);
    expect(validateCustomCode('a'.repeat(65)).ok).toBe(false);
    expect(validateCustomCode('').ok).toBe(false);
  });
});

describe('sessions', () => {
  const secret = 'test-secret';

  it('round-trips a valid token', () => {
    const token = createSessionToken(secret);
    expect(verifySessionToken(token, secret)).toBe(true);
  });

  it('rejects tampered and expired tokens', () => {
    const token = createSessionToken(secret);
    expect(verifySessionToken(token + 'x', secret)).toBe(false);
    expect(verifySessionToken(token, 'other-secret')).toBe(false);
    expect(verifySessionToken(undefined, secret)).toBe(false);
    const expired = createSessionToken(secret, Date.now() - 1000 * 60 * 60 * 24 * 14);
    expect(verifySessionToken(expired, secret)).toBe(false);
  });
});

describe('api keys', () => {
  it('generates sk_-prefixed keys and stable hashes', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^sk_[1-9A-HJ-NP-Za-km-z]{40}$/);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toBe(hashApiKey(generateApiKey()));
  });
});

describe('stats', () => {
  it('zero-fills the full range and counts clicks per day', () => {
    const db = openMemoryDb();
    const info = db.prepare("INSERT INTO links (code, url) VALUES ('abc', 'https://example.com')").run();
    const id = Number(info.lastInsertRowid);
    const now = new Date('2026-07-13T12:00:00Z');
    db.prepare('INSERT INTO clicks (link_id, ts) VALUES (?, ?)').run(id, '2026-07-13T08:00:00.000Z');
    db.prepare('INSERT INTO clicks (link_id, ts) VALUES (?, ?)').run(id, '2026-07-13T09:00:00.000Z');
    db.prepare('INSERT INTO clicks (link_id, ts) VALUES (?, ?)').run(id, '2026-07-10T09:00:00.000Z');
    db.prepare('INSERT INTO clicks (link_id, ts) VALUES (?, ?)').run(id, '2026-06-01T09:00:00.000Z'); // outside range

    const days = clicksByDay(db, 7, id, now);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-07-07');
    expect(days[6]).toEqual({ date: '2026-07-13', clicks: 2 });
    expect(days.find((d) => d.date === '2026-07-10')?.clicks).toBe(1);
    expect(days.reduce((s, d) => s + d.clicks, 0)).toBe(3);
    db.close();
  });
});
