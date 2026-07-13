import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildServer } from './server.js';

const config = loadConfig();
const db = openDb(config.dataDir);
const app = await buildServer(config, db);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Short links will be minted on ${config.appUrl}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
