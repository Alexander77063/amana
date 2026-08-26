import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './env';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/error-handler';
import { bodyFieldKey, clientIp, rateLimit } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { authRoute, logoutRoute, meRoute } from './routes/auth';
import { bumpsRoute } from './routes/bumps';
import { devicesRoute } from './routes/devices';
import { healthRoute } from './routes/health';
import { householdsRoute, meHouseholdRoute } from './routes/households';
import { marketplaceRoute } from './routes/marketplace';
import { meBumpsRoute } from './routes/me-bumps';
import { meSubWalletRoute } from './routes/me-sub-wallet';
import { mediaRoute } from './routes/media';
import { notificationPrefsRoute } from './routes/notification-prefs';
import { notificationsListRoute } from './routes/notifications';
import { pairingRoute } from './routes/pairing';
import { retailerAuthRoute } from './routes/retailer-auth';
import { retailerPortalRoute } from './routes/retailer-portal';
import { retailersRoute } from './routes/retailers';
import { subWalletsRoute } from './routes/sub-wallets';
import { transactionsRoute } from './routes/transactions';
import { vasRoute } from './routes/vas';
import { vendorClaimRoute } from './routes/vendor-claim';
import { vendorsRoute } from './routes/vendors';
import { vendorsAdminRoute } from './routes/vendors-admin';
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
  // The portal's OTP endpoints are the marketplace's only unauthenticated surface. Same limits
  // as the household ones: an unrated OTP route is an SMS bill and a business-enumeration oracle.
  for (const path of ['/retailer/auth/otp/request', '/retailer/auth/otp/verify']) {
    app.use(
      path,
      rateLimit({
        limit: env.RATE_LIMIT_OTP_PER_PHONE,
        windowSeconds,
        keyPrefix: `retailer-otp:phone:${path}`,
        key: bodyFieldKey('phone'),
      }),
    );
    app.use(
      path,
      rateLimit({
        limit: env.RATE_LIMIT_OTP_PER_IP,
        windowSeconds,
        keyPrefix: `retailer-otp:ip:${path}`,
        key: clientIp,
      }),
    );
  }

  // The vendor claim rail is the second unauthenticated OTP surface. Same reasoning as the
  // retailer portal's, plus one more: an unrated /request is a way to walk the registry.
  for (const path of ['/vendor-claim/request', '/vendor-claim/verify']) {
    app.use(
      path,
      rateLimit({
        limit: env.RATE_LIMIT_OTP_PER_PHONE,
        windowSeconds,
        keyPrefix: `vendor-claim:phone:${path}`,
        key: bodyFieldKey('phone'),
      }),
    );
    app.use(
      path,
      rateLimit({
        limit: env.RATE_LIMIT_OTP_PER_IP,
        windowSeconds,
        keyPrefix: `vendor-claim:ip:${path}`,
        key: clientIp,
      }),
    );
  }

  // The vendor-code lookup is authenticated, so it is not an enumeration surface — it is throttled
  // for a different reason: every valid code costs one Anchor name enquiry, and that call runs
  // through the SAME circuit breaker as real payments. Unthrottled scans can trip the breaker and
  // take spend down with them. The pattern is deliberately narrow (`/vendors/code/*`, not
  // `/vendors/*`) so `/vendors/recents` and the other spend-path reads stay unlimited.
  // Keyed by IP, like every other limiter here; per-actor keying is the right upgrade when the
  // store moves off in-process memory to Redis, and the token is too short-lived to key on today.
  app.use(
    '/vendors/code/*',
    rateLimit({
      limit: env.RATE_LIMIT_AUTH_PER_IP,
      windowSeconds,
      keyPrefix: 'vendor-code:ip',
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

/**
 * CORS for browser clients (the web demo harness today; the SP4b retailer portal later).
 *
 * Mounted ONLY when `CORS_ALLOWED_ORIGINS` names explicit origins — unset means no CORS
 * headers at all, which is exactly right for the native apps (they send no Origin) and keeps
 * production unchanged. The allowlist is exact-match and there is no wildcard branch: for a
 * money API, `*` alongside a bearer token is how a hostile page drains a wallet.
 *
 * `credentials` stays false: auth here is a bearer token, not a cookie, so the browser never
 * needs to attach ambient credentials.
 */
function attachCors(app: Hono): void {
  const allowed = env.CORS_ALLOWED_ORIGINS;
  if (allowed.length === 0) return;
  app.use(
    '*',
    cors({
      origin: (origin) => (allowed.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'x-admin-api-key'],
      credentials: false,
      maxAge: 600,
    }),
  );
  logger.info({ allowed }, 'CORS enabled for browser origins');
}

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  attachCors(app);
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
  app.route('/marketplace', marketplaceRoute);
  app.route('/retailers', retailersRoute);
  app.route('/retailer/auth', retailerAuthRoute);
  app.route('/retailer', retailerPortalRoute);
  app.route('/vas', vasRoute);
  app.route('/vendor-claim', vendorClaimRoute);
  app.route('/vendors-admin', vendorsAdminRoute);
  app.route('/media', mediaRoute);
  app.route('/', buildMeRouter());
  app.onError(errorHandler);
  return app;
}
