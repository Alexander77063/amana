import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { healthRoute } from './routes/health';

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  app.route('/health', healthRoute);
  app.onError(errorHandler);
  return app;
}
