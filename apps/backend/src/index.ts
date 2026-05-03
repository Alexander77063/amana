import { serve } from '@hono/node-server';
import { logger } from './lib/logger';
import { createServer } from './server';

const PORT = Number(process.env.PORT ?? 3000);

const app = createServer();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info({ port: info.port }, 'amana backend listening');
});
