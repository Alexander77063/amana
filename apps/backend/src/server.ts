import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { healthRoute } from './routes/health';
import { webhooksRoute } from './routes/webhooks';
import { vendorsRoute } from './routes/vendors';
import { transactionsRoute } from './routes/transactions';
import { bumpsRoute } from './routes/bumps';

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  app.route('/health', healthRoute);
  app.route('/webhooks', webhooksRoute);
  app.route('/vendors', vendorsRoute);
  app.route('/transactions', transactionsRoute);
  app.route('/bumps', bumpsRoute);
  app.onError(errorHandler);
  return app;
}
