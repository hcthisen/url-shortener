import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB, ApiKeyRow } from './db.js';

// --- Sessions: stateless signed cookie "exp.signature" -----------------------

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const SESSION_COOKIE = 'session';

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${sign(exp, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(exp, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(exp) > now;
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// --- API keys: sk_<40 base58 chars>, stored as SHA-256 hash ------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function generateApiKey(): string {
  const bytes = randomBytes(40);
  let out = 'sk_';
  for (let i = 0; i < 40; i++) out += BASE58[bytes[i] % BASE58.length];
  return out;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function verifyApiKey(db: DB, bearer: string | undefined): ApiKeyRow | null {
  if (!bearer || !bearer.startsWith('sk_')) return null;
  const row = db
    .prepare('SELECT * FROM api_keys WHERE key_hash = ?')
    .get(hashApiKey(bearer)) as ApiKeyRow | undefined;
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  return row;
}

// --- Login throttle: naive in-memory, 5 attempts per minute per IP -----------

const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginThrottled(ip: string, now = Date.now()): boolean {
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 5;
}
