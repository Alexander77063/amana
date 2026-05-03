import { Hono } from 'hono';
import { requestId } from './middleware/request-id';
import { healthRoute } from './routes/health';

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  app.route('/health', healthRoute);
  return app;
}
