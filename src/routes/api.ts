import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import type { Config } from '../config.js';
import type { DB, LinkRow, ApiKeyRow } from '../db.js';
import { generateCode, validateCustomCode } from '../codes.js';
import { SESSION_COOKIE, generateApiKey, hashApiKey, verifyApiKey, verifySessionToken } from '../auth.js';
import { clampDays, clicksByDay, sparklines, topLinks, topReferrers, totalClicks } from '../stats.js';

interface Ctx {
  db: DB;
  config: Config;
}

function apiError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

function linkJson(ctx: Ctx, row: LinkRow, clicks: number, sparkline?: number[]) {
  return {
    code: row.code,
    shortUrl: `${ctx.config.appUrl}/${row.code}`,
    url: row.url,
    note: row.note,
    clicks,
    ...(sparkline ? { sparkline } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerApiRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;

  function hasSession(req: FastifyRequest): boolean {
    return verifySessionToken(req.cookies[SESSION_COOKIE], config.sessionSecret);
  }

  /** API auth: Bearer API key (machines) or the admin session cookie (dashboard UI). */
  function authenticate(req: FastifyRequest): { key?: ApiKeyRow; session?: boolean } | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const key = verifyApiKey(db, auth.slice(7));
      return key ? { key } : null;
    }
    if (hasSession(req)) return { session: true };
    return null;
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (!authenticate(req)) {
      return apiError(reply, 401, 'unauthorized', 'Provide a valid API key as "Authorization: Bearer sk_...".');
    }
  });

  // --- Links -----------------------------------------------------------------

  app.post('/api/links', async (req, reply) => {
    const body = (req.body ?? {}) as { url?: unknown; code?: unknown; note?: unknown };
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url || !isValidHttpUrl(url)) {
      return apiError(reply, 400, 'invalid_url', 'Provide a valid http(s) URL in the "url" field.');
    }
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

    let code: string;
    if (body.code !== undefined && body.code !== null && body.code !== '') {
      if (typeof body.code !== 'string') {
        return apiError(reply, 400, 'invalid_code', 'The "code" field must be a string.');
      }
      const check = validateCustomCode(body.code);
      if (!check.ok) return apiError(reply, 400, 'invalid_code', check.reason);
      code = body.code;
      const existing = db.prepare('SELECT id FROM links WHERE code = ?').get(code);
      if (existing) return apiError(reply, 409, 'code_taken', `The code "${code}" is already in use.`);
    } else {
      do {
        code = generateCode();
      } while (db.prepare('SELECT id FROM links WHERE code = ?').get(code));
    }

    const info = db.prepare('INSERT INTO links (code, url, note) VALUES (?, ?, ?)').run(code, url, note);
    const row = db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid) as LinkRow;
    return reply.status(201).send(linkJson(ctx, row, 0));
  });

  app.get('/api/links', async (req) => {
    const q = req.query as { limit?: string; offset?: string; search?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
    const offset = Math.max(0, Number(q.offset ?? 0) || 0);
    const search = (q.search ?? '').trim();

    let rows: LinkRow[];
    let total: number;
    if (search) {
      const like = `%${search.replace(/[%_]/g, (m) => '\\' + m)}%`;
      rows = db
        .prepare(
          `SELECT * FROM links WHERE code LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(like, like, like, limit, offset) as LinkRow[];
      total = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM links WHERE code LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\'`,
          )
          .get(like, like, like) as { n: number }
      ).n;
    } else {
      rows = db.prepare('SELECT * FROM links ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as LinkRow[];
      total = (db.prepare('SELECT COUNT(*) AS n FROM links').get() as { n: number }).n;
    }

    const counts = new Map<number, number>();
    if (rows.length > 0) {
      const placeholders = rows.map(() => '?').join(',');
      const clickRows = db
        .prepare(`SELECT link_id, COUNT(*) AS n FROM clicks WHERE link_id IN (${placeholders}) GROUP BY link_id`)
        .all(...rows.map((r) => r.id)) as { link_id: number; n: number }[];
      for (const c of clickRows) counts.set(c.link_id, c.n);
    }
    const sparks = sparklines(db, rows.map((r) => r.id));

    return {
      items: rows.map((r) => linkJson(ctx, r, counts.get(r.id) ?? 0, sparks.get(r.id) ?? [0, 0, 0, 0, 0, 0, 0])),
      total,
    };
  });

  function findLink(code: string): LinkRow | undefined {
    return db.prepare('SELECT * FROM links WHERE code = ?').get(code) as LinkRow | undefined;
  }

  app.get('/api/links/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const row = findLink(code);
    if (!row) return apiError(reply, 404, 'not_found', `No link with code "${code}".`);
    return linkJson(ctx, row, totalClicks(db, row.id));
  });

  app.patch('/api/links/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const row = findLink(code);
    if (!row) return apiError(reply, 404, 'not_found', `No link with code "${code}".`);

    const body = (req.body ?? {}) as { url?: unknown; note?: unknown };
    let url = row.url;
    let note = row.note;
    if (body.url !== undefined) {
      if (typeof body.url !== 'string' || !isValidHttpUrl(body.url.trim())) {
        return apiError(reply, 400, 'invalid_url', 'The "url" field must be a valid http(s) URL.');
      }
      url = body.url.trim();
    }
    if (body.note !== undefined) {
      note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    }
    db.prepare(
      "UPDATE links SET url = ?, note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(url, note, row.id);
    const updated = findLink(code)!;
    return linkJson(ctx, updated, totalClicks(db, updated.id));
  });

  app.delete('/api/links/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const row = findLink(code);
    if (!row) return apiError(reply, 404, 'not_found', `No link with code "${code}".`);
    db.prepare('DELETE FROM links WHERE id = ?').run(row.id);
    return reply.status(204).send();
  });

  // --- Stats -----------------------------------------------------------------

  app.get('/api/links/:code/stats', async (req, reply) => {
    const { code } = req.params as { code: string };
    const row = findLink(code);
    if (!row) return apiError(reply, 404, 'not_found', `No link with code "${code}".`);
    const days = clampDays((req.query as { days?: string }).days);
    const byDay = clicksByDay(db, days, row.id);
    return {
      code: row.code,
      days,
      totalClicks: totalClicks(db, row.id),
      clicksInRange: byDay.reduce((sum, d) => sum + d.clicks, 0),
      clicksByDay: byDay,
      topReferrers: topReferrers(db, row.id, days),
    };
  });

  app.get('/api/stats', async (req) => {
    const days = clampDays((req.query as { days?: string }).days);
    const byDay = clicksByDay(db, days);
    return {
      days,
      totalLinks: (db.prepare('SELECT COUNT(*) AS n FROM links').get() as { n: number }).n,
      totalClicks: totalClicks(db),
      clicksInRange: byDay.reduce((sum, d) => sum + d.clicks, 0),
      clicksByDay: byDay,
      topLinks: topLinks(db, days),
    };
  });

  // --- QR code ----------------------------------------------------------------

  app.get('/api/links/:code/qr', async (req, reply) => {
    const { code } = req.params as { code: string };
    const row = findLink(code);
    if (!row) return apiError(reply, 404, 'not_found', `No link with code "${code}".`);
    const svg = await QRCode.toString(`${config.appUrl}/${row.code}`, {
      type: 'svg',
      margin: 1,
      width: 512,
      errorCorrectionLevel: 'M',
    });
    return reply.type('image/svg+xml').send(svg);
  });

  // --- API keys (dashboard session only — keys cannot mint other keys) --------

  function requireSession(req: FastifyRequest, reply: FastifyReply): boolean {
    if (hasSession(req)) return true;
    apiError(reply, 403, 'session_required', 'API key management requires a dashboard session.');
    return false;
  }

  app.get('/api/keys', async (req, reply) => {
    if (!requireSession(req, reply)) return reply;
    const rows = db.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC').all() as {
      id: number;
      name: string;
      prefix: string;
      created_at: string;
      last_used_at: string | null;
    }[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
      })),
    };
  });

  app.post('/api/keys', async (req, reply) => {
    if (!requireSession(req, reply)) return reply;
    const body = (req.body ?? {}) as { name?: unknown };
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null;
    if (!name) return apiError(reply, 400, 'invalid_name', 'Provide a "name" for the key (e.g. "CI pipeline").');
    const key = generateApiKey();
    const prefix = key.slice(0, 8); // "sk_" + 5 chars, enough to recognize it in the list
    const info = db.prepare('INSERT INTO api_keys (name, key_hash, prefix) VALUES (?, ?, ?)').run(name, hashApiKey(key), prefix);
    return reply.status(201).send({ id: Number(info.lastInsertRowid), name, prefix, key });
  });

  app.delete('/api/keys/:id', async (req, reply) => {
    if (!requireSession(req, reply)) return reply;
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    if (info.changes === 0) return apiError(reply, 404, 'not_found', `No API key with id ${id}.`);
    return reply.status(204).send();
  });

  // --- Session probe for the SPA ----------------------------------------------

  app.get('/api/me', async (req) => {
    return { authenticated: true, domain: new URL(config.appUrl).host, appUrl: config.appUrl };
  });
}
