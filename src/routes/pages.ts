import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { Config } from '../config.js';
import { SESSION_COOKIE, createSessionToken, loginThrottled, safeEqual, verifySessionToken } from '../auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve a path relative to the repo/app root (works from src via tsx and from dist/server). */
function fromRoot(...parts: string[]): string {
  for (const base of [join(__dirname, '..', '..'), join(__dirname, '..', '..', '..')]) {
    const candidate = join(base, ...parts);
    if (existsSync(candidate)) return candidate;
  }
  return join(__dirname, '..', '..', ...parts);
}

export function registerPageRoutes(app: FastifyInstance, config: Config): void {
  const publicDir = fromRoot('dist', 'public');
  const hasFrontend = existsSync(join(publicDir, 'index.html'));

  if (hasFrontend) {
    app.register(fastifyStatic, {
      root: publicDir,
      wildcard: false, // only explicit routes below serve index.html; /:code stays free for redirects
      index: false,
    });
  }

  const indexHtml = () => readFileSync(join(publicDir, 'index.html'), 'utf8');

  const spaRoutes = ['/login', '/dashboard', '/dashboard/keys', '/dashboard/links/:code'];
  for (const route of spaRoutes) {
    app.get(route, async (req, reply) => {
      if (!hasFrontend) return reply.status(503).send('Frontend not built. Run: npm run build');
      return reply.type('text/html').send(indexHtml());
    });
  }

  app.get('/', async (req, reply) => {
    const authed = verifySessionToken(req.cookies[SESSION_COOKIE], config.sessionSecret);
    return reply.redirect(authed ? '/dashboard' : '/login', 302);
  });

  // --- Login / logout ----------------------------------------------------------

  app.post('/login', async (req, reply) => {
    if (loginThrottled(req.ip)) {
      return reply.status(429).send({ error: { code: 'too_many_attempts', message: 'Too many attempts. Try again in a minute.' } });
    }
    const body = (req.body ?? {}) as { password?: unknown };
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || !safeEqual(password, config.adminPassword)) {
      return reply.status(401).send({ error: { code: 'invalid_password', message: 'That password is not correct.' } });
    }
    reply.setCookie(SESSION_COOKIE, createSessionToken(config.sessionSecret), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.appUrl.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 7,
    });
    return { ok: true };
  });

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // --- Public API documentation --------------------------------------------------

  const openapiPath = fromRoot('docs', 'openapi.yaml');
  let openapiJson: string | null = null;
  try {
    const spec = YAML.parse(readFileSync(openapiPath, 'utf8'));
    // The served spec should carry this instance's own URL so agents can use it directly.
    spec.servers = [{ url: `${config.appUrl}/api` }];
    openapiJson = JSON.stringify(spec);
  } catch {
    openapiJson = null;
  }

  app.get('/openapi.json', async (_req, reply) => {
    if (!openapiJson) return reply.status(500).send({ error: { code: 'spec_missing', message: 'OpenAPI spec not found.' } });
    return reply.type('application/json').send(openapiJson);
  });

  app.get('/docs', async (_req, reply) => {
    return reply.type('text/html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Reference — ${new URL(config.appUrl).host}</title>
</head>
<body>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script src="/vendor/scalar.js"></script>
</body>
</html>`);
  });

  const llmsPath = fromRoot('docs', 'llms.txt');
  app.get('/llms.txt', async (_req, reply) => {
    try {
      const text = readFileSync(llmsPath, 'utf8').replaceAll('https://<domain>', config.appUrl);
      return reply.type('text/plain; charset=utf-8').send(text);
    } catch {
      return reply.status(404).send('llms.txt not found');
    }
  });

  app.get('/robots.txt', async (_req, reply) => {
    return reply.type('text/plain').send('User-agent: *\nDisallow: /dashboard\nDisallow: /api\n');
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
}
