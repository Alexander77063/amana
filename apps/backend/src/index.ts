import { serve } from '@hono/node-server';
import { env } from './env';
import { logger } from './lib/logger';
import { createServer } from './server';

const app = createServer();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, nodeEnv: env.NODE_ENV }, 'amana backend listening');
});
