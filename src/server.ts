import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { registerApiRoutes } from './routes/api.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerRedirectRoute } from './routes/redirect.js';

export async function buildServer(config: Config, db: DB): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.dev ? { level: 'info' } : { level: 'warn' },
    trustProxy: true,
  });

  await app.register(fastifyCookie);

  registerApiRoutes(app, { db, config });
  registerPageRoutes(app, config);
  registerRedirectRoute(app, db);

  return app;
}
