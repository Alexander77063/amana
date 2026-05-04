import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { authRoute, logoutRoute, meRoute } from './routes/auth';
import { bumpsRoute } from './routes/bumps';
import { devicesRoute } from './routes/devices';
import { healthRoute } from './routes/health';
import { notificationPrefsRoute } from './routes/notification-prefs';
import { notificationsListRoute } from './routes/notifications';
import { pairingRoute } from './routes/pairing';
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
  app.route('/auth', authRoute);
  app.route('/pairing', pairingRoute);
  app.route('/', meRoute);
  app.route('/', logoutRoute);
  app.route('/', notificationPrefsRoute);
  app.route('/', notificationsListRoute);
  app.onError(errorHandler);
  return app;
}
