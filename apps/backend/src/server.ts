import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { bumpsRoute } from './routes/bumps';
import { devicesRoute } from './routes/devices';
import { healthRoute } from './routes/health';
import { notificationPrefsRoute } from './routes/notification-prefs';
import { transactionsRoute } from './routes/transactions';
import { vendorsRoute } from './routes/vendors';
import { webhooksRoute } from './routes/webhooks';

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  app.route('/health', healthRoute);
  app.route('/webhooks', webhooksRoute);
  app.route('/vendors', vendorsRoute);
  app.route('/transactions', transactionsRoute);
  app.route('/bumps', bumpsRoute);
  app.route('/devices', devicesRoute);
  app.route('/', notificationPrefsRoute);
  app.onError(errorHandler);
  return app;
}
