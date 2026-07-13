import type { FastifyInstance } from 'fastify';
import type { DB, LinkRow } from '../db.js';
import { CUSTOM_CODE_RE } from '../codes.js';

export function registerRedirectRoute(app: FastifyInstance, db: DB): void {
  const insertClick = db.prepare('INSERT INTO clicks (link_id, referrer, user_agent) VALUES (?, ?, ?)');
  const findLink = db.prepare('SELECT * FROM links WHERE code = ?');

  // Reserved paths are registered as explicit routes, so anything reaching this
  // handler is either a short code or a 404. Fastify matches static routes first.
  app.get('/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    if (!CUSTOM_CODE_RE.test(code)) return notFound(reply, code);

    const row = findLink.get(code) as LinkRow | undefined;
    if (!row) return notFound(reply, code);

    const referrer = (req.headers.referer as string | undefined) ?? null;
    const userAgent = (req.headers['user-agent'] as string | undefined)?.slice(0, 400) ?? null;
    // Record the click off the hot path so the redirect is never delayed by the write.
    setImmediate(() => {
      try {
        insertClick.run(row.id, referrer, userAgent);
      } catch {
        /* a lost click must never break anything */
      }
    });

    return reply.redirect(row.url, 302);
  });

  function notFound(reply: import('fastify').FastifyReply, code: string) {
    return reply
      .status(404)
      .type('text/html')
      .send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Not found</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #f9f9f7; color: #0b0b0b;
    }
    @media (prefers-color-scheme: dark) { body { background: #0d0d0d; color: #fff; } }
    main { text-align: center; padding: 2rem; }
    .code { font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace; opacity: 0.6; }
    h1 { font-size: 1.4rem; font-weight: 600; margin: 0.5rem 0; }
    p { opacity: 0.65; }
  </style>
</head>
<body>
  <main>
    <div class="code">404</div>
    <h1>This short link doesn't exist</h1>
    <p>The link <span class="code">/${escapeHtml(code).slice(0, 80)}</span> was not found or has been removed.</p>
  </main>
</body>
</html>`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
