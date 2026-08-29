// apps/backend/src/middleware/admin-session.ts
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { db } from '../db/client';
import { adminIdentityService } from '../modules/admin/admin-identity.service';
import type { AdminUserRow } from '../modules/admin/admin-users.repo';

/** The cookie the portal carries. Named for the product, not the framework. */
export const ADMIN_SESSION_COOKIE = 'amana_admin_session';

export type AdminActor = { adminUserId: string; email: string; sessionId: string };
export type AdminActorVariables = { adminActor: AdminActor };

/**
 * Authenticate a member of staff from their session cookie.
 *
 * This is the replacement for `admin-auth.ts`'s shared `x-admin-api-key`, and the two live side
 * by side deliberately until Task 4 cuts the 13 ops endpoints over and deletes the key. Do not
 * shortcut that: a fallback from one to the other would be the original vulnerability with extra
 * steps, which is exactly what the plan says not to build.
 *
 * It AUTHENTICATES only. It answers "which member of staff is this", never "may they do this" —
 * there are no roles until Task 2, and when there are, the permission check belongs in the
 * service layer for the same reason `wallet-access.service` does: a check a route performs is a
 * check the next caller can forget.
 */
export const adminSession =
  (): MiddlewareHandler<{ Variables: AdminActorVariables }> => async (c, next) => {
    const token = getCookie(c, ADMIN_SESSION_COOKIE);
    // One shape for every failure — absent, forged, expired, revoked, suspended. A staff-facing
    // surface is still a surface, and "this token was valid until recently" is worth nothing to
    // a legitimate operator and something to everyone else.
    if (!token) return c.json({ error: 'admin_unauthorized' }, 401);

    const resolved = await adminIdentityService.resolveSession(db, token);
    if (!resolved) return c.json({ error: 'admin_unauthorized' }, 401);

    c.set('adminActor', {
      adminUserId: resolved.adminUser.id,
      email: resolved.adminUser.email,
      sessionId: resolved.sessionId,
    } satisfies AdminActor);
    await next();
  };

/** Shape returned by `/admin/me`. Kept next to the middleware that produces the actor. */
export function adminSelf(
  adminUser: AdminUserRow,
  roles: readonly string[],
  permissions: readonly string[],
): {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
} {
  return {
    id: adminUser.id,
    email: adminUser.email,
    displayName: adminUser.displayName,
    roles: [...roles],
    // Permissions as well as roles, because the portal should render from capabilities rather
    // than re-implement the role matrix in the client — two copies of that mapping would drift,
    // and the client's copy would be the one nobody tested.
    permissions: [...permissions],
  };
}
