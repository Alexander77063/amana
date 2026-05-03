import { serve } from '@hono/node-server';
import { createServer } from './server';

const PORT = Number(process.env.PORT ?? 3000);

const app = createServer();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // biome-ignore lint/suspicious/noConsoleLog: bootstrap startup banner
  console.log(`amana backend listening on http://localhost:${info.port}`);
});
