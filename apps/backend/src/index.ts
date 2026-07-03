import { serve } from '@hono/node-server';
import { closeDb } from './db/client';
import { env } from './env';
import { logger } from './lib/logger';
import { initSentry } from './lib/sentry';
import { createServer } from './server';

initSentry();

const app = createServer();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, nodeEnv: env.NODE_ENV }, 'amana backend listening');
});

// Graceful shutdown: the orchestrator (Fly) sends SIGTERM on every deploy/restart. Stop accepting
// new connections, let in-flight requests (money operations) drain, then close the DB pool — so a
// deploy can't cut a settlement/top-up mid-flight or leak connections. A hard-stop timer guards
// against a stuck request blocking the deploy forever.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'amana backend shutting down');

  // Fit inside Fly's default 5s kill grace. Bumping fly.toml `kill_timeout` (e.g. 10s) gives more
  // headroom for in-flight money ops to drain; keep this under whatever that grace is.
  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 4_500);
  force.unref();

  server.close(); // stop accepting new connections; in-flight requests continue
  try {
    await closeDb(); // drain the Postgres pool (waits up to 5s)
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'error closing db on shutdown');
  }
  clearTimeout(force);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('uncaughtException', (e) => {
  logger.error({ err: e.message, stack: e.stack }, 'backend uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'backend unhandled rejection');
  process.exit(1);
});
