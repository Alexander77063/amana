import { serve } from '@hono/node-server';
import { env } from './env';
import { logger } from './lib/logger';
import { initSentry } from './lib/sentry';
import { createServer } from './server';

initSentry();

const app = createServer();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, nodeEnv: env.NODE_ENV }, 'amana backend listening');
});
