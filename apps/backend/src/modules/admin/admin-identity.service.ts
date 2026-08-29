import { createHash, randomBytes } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { adminAuthRequestsRepo } from './admin-auth-requests.repo';
import { adminSessionsRepo } from './admin-sessions.repo';
import { type AdminUserRow, adminUsersRepo } from './admin-users.repo';
import type { OidcProvider } from './oidc/types';

type DbOrTx = PostgresJsDatabase;

/**
 * Email addresses are compared case-insensitively everywhere in this module: Google returns the
 * canonical form, but the configured bootstrap address is typed by a human into a Fly secret.
 * One capital letter must not create a second, unreachable admin.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 32 bytes of CSPRNG, base64url — 43 characters, no padding. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** RFC 7636 S256: the challenge is the base64url SHA-256 of the verifier. */
function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export type StartLoginResult = {
  authorizationUrl: string;
  state: string;
};

/**
 * Why a sign-in was refused. Every one of these is answered to the browser identically (see
 * `routes/admin/auth.ts`) — the distinction exists for the audit log, not for the caller.
 */
export type SignInDenial =
  | 'unknown_state'
  | 'exchange_failed'
  | 'email_unverified'
  | 'outside_workspace_domain'
  | 'not_provisioned'
  | 'suspended'
  | 'subject_mismatch';

export type CompleteLoginResult =
  | {
      kind: 'signed_in';
      adminUser: AdminUserRow;
      sessionToken: string;
      expiresAt: Date;
    }
  | { kind: 'denied'; reason: SignInDenial; email: string | null };

export type ResolvedAdminSession = {
  adminUser: AdminUserRow;
  sessionId: string;
};

export const adminIdentityService = {
  /**
   * Create the first owner from configuration, if it does not already exist.
   *
   * Invariant 6: there must be no code path that mints an owner from nothing. This one is
   * deliberately not reachable over HTTP — it is called once at boot from `src/index.ts` — and it
   * can only ever produce the single address in `ADMIN_BOOTSTRAP_OWNER_EMAIL`. Running it again
   * is a no-op, so a restart loop cannot multiply owners.
   */
  async ensureBootstrapOwner(db: DbOrTx): Promise<void> {
    await adminUsersRepo.insertIfAbsent(db, {
      email: normaliseEmail(env.ADMIN_BOOTSTRAP_OWNER_EMAIL),
      provisioningSource: 'config',
    });
  },

  /**
   * Begin a sign-in: mint state, nonce and a PKCE verifier, persist them, and return the URL to
   * send the browser to. Only the state's digest is stored, and the verifier never leaves us.
   */
  async startLogin(
    db: DbOrTx,
    provider: OidcProvider,
    now: Date = new Date(),
  ): Promise<StartLoginResult> {
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();

    await adminAuthRequestsRepo.insert(db, {
      stateHash: sha256(state),
      nonce,
      codeVerifier,
      expiresAt: new Date(now.getTime() + env.ADMIN_LOGIN_TTL_SECONDS * 1000),
    });

    return {
      state,
      authorizationUrl: provider.authorizationUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
      }),
    };
  },

  /**
   * Finish a sign-in. Order matters, and it is the reverse of convenience:
   *
   * 1. The state must be a live, unconsumed request of ours (CSRF, and single-use).
   * 2. Google must verify the code and return an ID token matching our nonce.
   * 3. The email must be verified AND inside the Workspace domain, by both the address and
   *    Google's own `hd` claim.
   * 4. An `admin_users` row must already exist. Signing in does NOT create one — Task 2's
   *    onboarding does. So in Task 1 exactly one person can sign in: the seeded owner.
   * 5. The account must not be suspended.
   * 6. The Google subject must match the one bound to this admin, if one is bound.
   *
   * Every refusal returns a denial rather than throwing: the caller has to audit it, and an
   * exception is easy to catch and forget.
   */
  async completeLogin(
    db: DbOrTx,
    provider: OidcProvider,
    input: { state: string; code: string },
    now: Date = new Date(),
  ): Promise<CompleteLoginResult> {
    const request = await adminAuthRequestsRepo.consume(db, sha256(input.state), now);
    if (!request) return { kind: 'denied', reason: 'unknown_state', email: null };

    let identity: Awaited<ReturnType<OidcProvider['exchangeCode']>>;
    try {
      identity = await provider.exchangeCode({
        code: input.code,
        codeVerifier: request.codeVerifier,
        nonce: request.nonce,
      });
    } catch {
      // A failed exchange is a bad code, a replayed code, a nonce mismatch or a signature that
      // did not verify. None of them is distinguishable to us and none of them is a sign-in.
      return { kind: 'denied', reason: 'exchange_failed', email: null };
    }

    const email = normaliseEmail(identity.email);

    /**
     * Record a refusal and return it.
     *
     * Only reachable AFTER Google has verified an identity, deliberately. The two refusals that
     * happen before that — an unknown state and a failed exchange — are not audited, because the
     * callback is unauthenticated: anything written before identity is established is a row an
     * anonymous caller can create at will, and an append-only table is a poor place to let them.
     * Those are bounded by the route's rate limiter instead.
     */
    const deny = async (
      reason: SignInDenial,
      adminUserId: string | null,
    ): Promise<CompleteLoginResult> => {
      await auditRepo.append(
        db,
        auditEvents.adminSignInDenied({
          adminUserId,
          subjectId: adminUserId ?? request.id,
          reason,
          email,
          workspaceDomain: env.ADMIN_WORKSPACE_DOMAIN,
          at: now,
        }),
      );
      return { kind: 'denied', reason, email };
    };

    if (!identity.emailVerified) {
      return deny('email_unverified', null);
    }

    // Both halves are required, and the second is the one that does the work. The address's
    // domain is the obvious check, but an address is a string on a profile: a personal Google
    // account can set it to anything. `hd` is asserted by Google about the account itself and is
    // present only for Workspace members, so it is what actually proves membership.
    const domain = env.ADMIN_WORKSPACE_DOMAIN.toLowerCase();
    if (email.split('@')[1] !== domain || identity.hostedDomain?.toLowerCase() !== domain) {
      return deny('outside_workspace_domain', null);
    }

    const adminUser = await adminUsersRepo.findByEmail(db, email);
    if (!adminUser) return deny('not_provisioned', null);
    if (adminUser.status !== 'active') return deny('suspended', adminUser.id);

    // First sign-in binds the Google subject; every later one must match it. A Workspace address
    // that has been deleted and recreated comes back with a new `sub`, and that is a different
    // human until an admin says otherwise — it must not silently inherit the old one's access.
    if (adminUser.googleSubject !== null && adminUser.googleSubject !== identity.subject) {
      return deny('subject_mismatch', adminUser.id);
    }

    const updated = await adminUsersRepo.recordSignIn(db, adminUser.id, {
      googleSubject: identity.subject,
      displayName: identity.name,
      now,
    });

    const sessionToken = randomToken();
    const expiresAt = new Date(now.getTime() + env.ADMIN_SESSION_TTL_SECONDS * 1000);
    await adminSessionsRepo.insert(db, {
      adminUserId: adminUser.id,
      tokenHash: sha256(sessionToken),
      expiresAt,
    });

    await auditRepo.append(
      db,
      auditEvents.adminSignedIn({ adminUserId: adminUser.id, email, at: now }),
    );

    return { kind: 'signed_in', adminUser: updated, sessionToken, expiresAt };
  },

  /** Resolve a session cookie to its admin, or null. Refreshes `last_used_at` as a side effect. */
  async resolveSession(
    db: DbOrTx,
    sessionToken: string,
    now: Date = new Date(),
  ): Promise<ResolvedAdminSession | null> {
    const found = await adminSessionsRepo.findLiveByTokenHash(db, sha256(sessionToken), now);
    if (!found) return null;
    // A suspended admin's live sessions must stop working at the next request, not at expiry.
    // Task 2 will also revoke them on suspension; this check is the one that holds regardless.
    if (found.adminUser.status !== 'active') return null;
    await adminSessionsRepo.touch(db, found.session.id, now);
    return { adminUser: found.adminUser, sessionId: found.session.id };
  },

  async signOut(db: DbOrTx, sessionToken: string, now: Date = new Date()): Promise<void> {
    await adminSessionsRepo.revokeByTokenHash(db, sha256(sessionToken), now);
  },
};
