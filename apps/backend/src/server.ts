import { Hono } from 'hono';
import { env } from './env';
import { errorHandler } from './middleware/error-handler';
import { bodyFieldKey, clientIp, rateLimit } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { authRoute, logoutRoute, meRoute } from './routes/auth';
import { bumpsRoute } from './routes/bumps';
import { devicesRoute } from './routes/devices';
import { healthRoute } from './routes/health';
import { householdsRoute, meHouseholdRoute } from './routes/households';
import { meBumpsRoute } from './routes/me-bumps';
import { meSubWalletRoute } from './routes/me-sub-wallet';
import { mediaRoute } from './routes/media';
import { notificationPrefsRoute } from './routes/notification-prefs';
import { notificationsListRoute } from './routes/notifications';
import { pairingRoute } from './routes/pairing';
import { subWalletsRoute } from './routes/sub-wallets';
import { transactionsRoute } from './routes/transactions';
import { vendorsRoute } from './routes/vendors';
import { webhooksRoute } from './routes/webhooks';

function buildMeRouter(): Hono {
  return new Hono()
    .route('/', meRoute)
    .route('/', logoutRoute)
    .route('/', meHouseholdRoute)
    .route('/', meBumpsRoute)
    .route('/', meSubWalletRoute)
    .route('/', notificationPrefsRoute)
    .route('/', notificationsListRoute);
}

/**
 * Attach rate limiters to the abuse-prone auth/pairing surface. OTP endpoints
 * are limited both per-phone (SMS cost / victim protection) and per-IP
 * (attacker rotating phones); refresh and pairing are limited per-IP.
 * Registered before the route mounts so the middleware runs first.
 */
function attachRateLimiters(app: Hono): void {
  if (!env.RATE_LIMIT_ENABLED) return;
  const windowSeconds = env.RATE_LIMIT_WINDOW_SECONDS;

  app.use(
    '/auth/otp/request',
    rateLimit({
      limit: env.RATE_LIMIT_OTP_PER_PHONE,
      windowSeconds,
      keyPrefix: 'otp-req:phone',
      key: bodyFieldKey('phone'),
    }),
  );
  app.use(
    '/auth/otp/request',
    rateLimit({
      limit: env.RATE_LIMIT_OTP_PER_IP,
      windowSeconds,
      keyPrefix: 'otp-req:ip',
      key: clientIp,
    }),
  );
  app.use(
    '/auth/otp/verify',
    rateLimit({
      limit: env.RATE_LIMIT_OTP_PER_PHONE * 2,
      windowSeconds,
      keyPrefix: 'otp-verify:phone',
      key: bodyFieldKey('phone'),
    }),
  );
  app.use(
    '/auth/otp/verify',
    rateLimit({
      limit: env.RATE_LIMIT_AUTH_PER_IP,
      windowSeconds,
      keyPrefix: 'otp-verify:ip',
      key: clientIp,
    }),
  );
  app.use(
    '/auth/refresh',
    rateLimit({
      limit: env.RATE_LIMIT_AUTH_PER_IP,
      windowSeconds,
      keyPrefix: 'refresh:ip',
      key: clientIp,
    }),
  );
  for (const path of ['/pairing', '/pairing/*']) {
    app.use(
      path,
      rateLimit({
        limit: env.RATE_LIMIT_PAIRING_PER_IP,
        windowSeconds,
        keyPrefix: 'pairing:ip',
        key: clientIp,
      }),
    );
  }
}

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  attachRateLimiters(app);
  app.route('/health', healthRoute);
  app.route('/webhooks', webhooksRoute);
  app.route('/vendors', vendorsRoute);
  app.route('/transactions', transactionsRoute);
  app.route('/bumps', bumpsRoute);
  app.route('/devices', devicesRoute);
  app.route('/auth', authRoute);
  app.route('/pairing', pairingRoute);
  app.route('/households', householdsRoute);
  app.route('/sub-wallets', subWalletsRoute);
  app.route('/media', mediaRoute);
  app.route('/', buildMeRouter());
  app.onError(errorHandler);
  return app;
}
