import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * Constant-time compare that does not leak length through early return timing
 * beyond what the length check itself reveals (mirrors `webhook.ts safeEqualHex`).
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Ops-only auth for the retailer onboarding surface (`x-admin-api-key`).
 *
 * Deliberately NOT `jwtAuth`: retailer-facing auth is SP4b (the portal). This is a
 * shared ops secret, so these routes must only ever touch retailer onboarding state —
 * never a wallet, ledger, or transaction path, which authorize by user identity vs.
 * ownership. An unset key means DENY (never "open"), so a misconfigured production
 * boot fails closed rather than exposing the admin surface.
 */
export const adminAuth =
  (configuredKey: string | undefined): MiddlewareHandler =>
  async (c, next) => {
    const provided = c.req.header('x-admin-api-key');
    if (!configuredKey || !provided || !safeEqual(provided, configuredKey)) {
      return c.json({ error: 'admin_unauthorized' }, 401);
    }
    await next();
  };
