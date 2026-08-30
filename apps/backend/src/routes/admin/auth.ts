import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { db } from '../../db/client';
import { env } from '../../env';
import {
  ADMIN_SESSION_COOKIE,
  type AdminActorVariables,
  adminSelf,
  adminSession,
} from '../../middleware/admin-session';
import { adminIamService } from '../../modules/admin/admin-iam.service';
import { adminIdentityService } from '../../modules/admin/admin-identity.service';
import { adminUsersRepo } from '../../modules/admin/admin-users.repo';
import { createGoogleOidcProvider } from '../../modules/admin/oidc/google-oidc.provider';
import type { OidcProvider } from '../../modules/admin/oidc/types';
import { auditRepo } from '../../modules/audit/audit.repo';
import { auditEvents } from '../../modules/audit/events';

const CallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * The production provider, built from configuration.
 *
 * Constructed lazily at mount time rather than at import: `createRemoteJWKSet` is inert until it
 * verifies something, so this costs nothing in dev or test, where the Google credentials are
 * blank and no admin sign-in is attempted.
 */
export function defaultAdminOidcProvider(): OidcProvider {
  return createGoogleOidcProvider({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    redirectUri: env.ADMIN_OIDC_REDIRECT_URI,
    hostedDomainHint: env.ADMIN_WORKSPACE_DOMAIN,
  });
}

/**
 * Where a refused sign-in is sent. ONE destination for every reason.
 *
 * The service distinguishes seven denials so the audit log can, but the browser is told only that
 * it failed. Anything finer is a staff-directory enumeration oracle reachable from outside: the
 * difference between "not provisioned" and "outside the domain" answers "does this person work
 * at Amana", which is not a question this endpoint should answer. Same reasoning as the vendor
 * claim rail's non-oracle 202.
 */
function signInFailedRedirect(): string {
  return `${env.ADMIN_PORTAL_URL}/sign-in?error=sign_in_failed`;
}

/**
 * Admin sign-in over Google Workspace OIDC. Mounted at `/admin/auth`.
 *
 * The provider is a parameter so tests drive the whole HTTP path without reaching Google — the
 * `amana-ng.com` Workspace tenant does not exist yet, and Task 1 is specified to be buildable
 * before it does.
 */
export function createAdminAuthRoute(
  provider: OidcProvider = defaultAdminOidcProvider(),
): Hono<{ Variables: AdminActorVariables }> {
  return new Hono<{ Variables: AdminActorVariables }>()
    .get('/start', async (c) => {
      const started = await adminIdentityService.startLogin(db, provider);
      return c.redirect(started.authorizationUrl, 302);
    })

    .get('/callback', async (c) => {
      const parsed = CallbackQuery.safeParse({
        code: c.req.query('code'),
        state: c.req.query('state'),
      });
      // A callback missing either half is not a sign-in attempt we started. It gets the same
      // answer as a refused one — there is nothing to tell apart here either.
      if (!parsed.success) return c.redirect(signInFailedRedirect(), 302);

      const result = await adminIdentityService.completeLogin(db, provider, parsed.data);
      if (result.kind !== 'signed_in') return c.redirect(signInFailedRedirect(), 302);

      setCookie(c, ADMIN_SESSION_COOKIE, result.sessionToken, {
        httpOnly: true,
        // Always, including in dev. The portal is served over HTTPS behind Cloudflare Access and
        // `admin.amana-ng.com` inherits HSTS preload with `includeSubDomains`; a cookie that
        // would travel over plain HTTP anywhere is a cookie that can be made to.
        secure: true,
        // Lax, not Strict: the callback arrives as a top-level navigation from Google, and Strict
        // withholds the cookie on exactly that hop, so the session would be set and instantly
        // invisible. Lax still withholds it from cross-site sub-requests, which is the threat.
        sameSite: 'Lax',
        path: '/',
        expires: result.expiresAt,
      });
      return c.redirect(env.ADMIN_PORTAL_URL, 302);
    })

    .post('/logout', adminSession(), async (c) => {
      const actor = c.get('adminActor');
      // Revoke server-side FIRST. Clearing the cookie only asks the browser to forget the token;
      // revoking is what stops it working for anyone who kept a copy.
      const token = getCookie(c, ADMIN_SESSION_COOKIE);
      if (token) await adminIdentityService.signOut(db, token);
      await auditRepo.append(
        db,
        auditEvents.adminSignedOut({ adminUserId: actor.adminUserId, at: new Date() }),
      );
      deleteCookie(c, ADMIN_SESSION_COOKIE, { path: '/' });
      return c.body(null, 204);
    });
}

/** `GET /admin/me` — who the portal is talking to. Mounted at `/admin`. */
export const adminMeRoute = new Hono<{ Variables: AdminActorVariables }>().get(
  '/me',
  adminSession(),
  async (c) => {
    const actor = c.get('adminActor');
    const adminUser = await adminUsersRepo.findById(db, actor.adminUserId);
    if (!adminUser) return c.json({ error: 'admin_unauthorized' }, 401);
    const roles = await adminIamService.rolesFor(db, adminUser.id);
    const permissions = await adminIamService.permissionsFor(db, adminUser.id);
    return c.json(adminSelf(adminUser, roles, permissions), 200);
  },
);
