export interface Config {
  appUrl: string;
  adminPassword: string;
  sessionSecret: string;
  port: number;
  dataDir: string;
  dev: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dev = env.NODE_ENV !== 'production';

  const appUrl = env.APP_URL ?? (dev ? 'http://localhost:3000' : '');
  const adminPassword = env.ADMIN_PASSWORD ?? (dev ? 'admin' : '');
  const sessionSecret = env.SESSION_SECRET ?? (dev ? 'dev-secret-not-for-production' : '');

  const missing: string[] = [];
  if (!appUrl) missing.push('APP_URL');
  if (!adminPassword) missing.push('ADMIN_PASSWORD');
  if (!sessionSecret) missing.push('SESSION_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `See .env.example for descriptions.`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error(`APP_URL is not a valid URL: ${appUrl}`);
  }

  return {
    appUrl: parsedUrl.origin,
    adminPassword,
    sessionSecret,
    port: Number(env.PORT ?? 3000),
    dataDir: env.DATA_DIR ?? (dev ? './data' : '/data'),
    dev,
  };
}
