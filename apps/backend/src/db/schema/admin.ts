import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const adminUserStatusEnum = pgEnum('admin_user_status', ['active', 'suspended']);

/**
 * How this admin came to exist. `config` is the bootstrap owner seeded from
 * `ADMIN_BOOTSTRAP_OWNER_EMAIL`; `admin` is someone onboarded by another admin (Task 2).
 *
 * Recorded in the data rather than inferred, because invariant 6 — "the first owner is seeded
 * from config, never minted by an endpoint" — is only auditable afterwards if the row says which
 * path created it.
 */
export const adminProvisioningSourceEnum = pgEnum('admin_provisioning_source', ['config', 'admin']);

/**
 * Amana staff. Deliberately NOT rows in `users`.
 *
 * `users` requires `phone` (unique), `nin` (NOT NULL) and a `kyc_tier`: it models a Nigerian
 * customer who has been through KYC. Putting staff there would mean inventing a National
 * Identity Number per employee — fabricated national-ID data sitting in the same encrypted
 * column as real customers' — to satisfy a NOT NULL. Staff have no wallet, no household and no
 * NIN we are entitled to hold, so they get their own table and `audit_log` grows a second actor
 * column instead (see `0042`).
 *
 * There is no role column: roles are Task 2's append-only `admin_role_grants`. A row here proves
 * WHO someone is and nothing about what they may do — which is exactly invariant 4, least
 * privilege by default, expressed in the schema.
 */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // Lower-cased before write. The Workspace domain is enforced in the service layer, not by a
  // CHECK, so the domain can change without a migration on an append-only-adjacent table.
  email: text('email').notNull().unique(),
  // Google's stable subject claim, bound on first successful sign-in. Null until then, so the
  // seeded owner exists before anyone has ever signed in. Unique: one Google identity cannot
  // become two admins.
  googleSubject: text('google_subject').unique(),
  displayName: text('display_name'),
  status: adminUserStatusEnum('status').notNull().default('active'),
  provisioningSource: adminProvisioningSourceEnum('provisioning_source').notNull(),
  lastSignedInAt: timestamp('last_signed_in_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The five fixed roles (sub-plan A1's role matrix). Fixed, not a granular permission matrix, so
 * that "who can do what" stays auditable by reading one table — and because a role can be added
 * later, whereas a granular matrix cannot be un-shipped.
 */
export const adminRoleEnum = pgEnum('admin_role', ['owner', 'admin', 'ops', 'support', 'auditor']);

/** Who caused a grant to exist: configuration (the bootstrap) or another admin. */
export const adminGrantSourceEnum = pgEnum('admin_grant_source', ['config', 'admin']);

/**
 * An append-only log of role grant EVENTS, not a set of roles per admin.
 *
 * Directly modelled on `vendor_consents`, and for the same reason: the question an incident review
 * asks is "what could this person do **at the time they did it**", and a mutable set only knows
 * the present. A revocation is a new row; nothing is ever UPDATEd or DELETEd.
 * `adminRoleGrantsRepo.currentRoles` folds the log, and the log is the evidence.
 */
export const adminRoleGrants = pgTable(
  'admin_role_grants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /**
     * Strict append order, and the ONLY thing the fold sorts on.
     *
     * `recorded_at` cannot do this job, and `vendor_consents` proved it: a grant and its
     * revocation can legitimately share a timestamp when both are written in one transaction with
     * a single `now`. Tie-breaking then falls to a random `gen_random_uuid()`, which decides who
     * holds a role by chance — that table passed its tests once and failed on the next run. A
     * sequence is monotonic by construction and needs no clock.
     */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    role: adminRoleEnum('role').notNull(),
    /** true = granted, false = revoked. Both are rows; neither overwrites the other. */
    granted: boolean('granted').notNull(),
    /**
     * Who granted or revoked it. **Nullable, and null means configuration** — the bootstrap
     * account's own roles have no granter, exactly as `admin_users.provisioningSource = 'config'`
     * marks the row that no admin created. Every other grant must name a person, and
     * `restrict` on delete keeps that name attached for as long as the grant is on record.
     */
    grantedByAdminUserId: uuid('granted_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'restrict',
    }),
    source: adminGrantSourceEnum('source').notNull(),
    /** Free text from the granting admin. Not required, but recorded when given. */
    reason: text('reason'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The read is always "latest row for this admin and role", so index the pair.
    byAdminRole: index('admin_role_grants_by_admin_role').on(t.adminUserId, t.role),
  }),
);

/**
 * What kind of action is being proposed. One value today; the table is generic on purpose,
 * because the ops actions (vendor suspend, approve-claim, consent revoke) join it once Task 4
 * gives those routes an identity to record as the maker.
 */
export const adminApprovalKindEnum = pgEnum('admin_approval_kind', [
  'role_grant',
  /**
   * `POST /vendors-admin/vendors/:id/approve-claim` — mints a public code and assigns a business
   * identity on an operator's say-so, i.e. hands ownership of a bank account to a named person.
   * The most powerful action on the vendor rail, and the only ops action that is gated.
   *
   * `suspend` and `consents/revoke` are deliberately NOT here. Same principle as revocation in
   * Task 3: gate the direction that CREATES power, never the one that removes it. Suspend is the
   * anti-fraud kill switch, and consent revocation is the merchant's NDPA withdrawal channel,
   * which must stay as easy as granting.
   */
  'vendor_approve_claim',
]);

export const adminApprovalStatusEnum = pgEnum('admin_approval_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  /** Written by the cron sweep, never inferred at read time. */
  'expired',
]);

/**
 * Maker-checker: a proposed action, who proposed it, who decided it, and what was decided.
 *
 * Covers role grants and vendor claim approvals — the two actions that CREATE power, one over the
 * system and one over a bank account. Note the asymmetry with every removal: revoking a role,
 * suspending a vendor and revoking a merchant's consent are all ungated, because requiring two
 * people to remove something leaves the dangerous state in place while a second admin is found.
 * The gate belongs on the direction that creates power.
 */
export const adminApprovals = pgTable(
  'admin_approvals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    kind: adminApprovalKindEnum('kind').notNull(),
    status: adminApprovalStatusEnum('status').notNull().default('pending'),
    /** The action's parameters. Re-validated at apply time — a proposal is a request, not a write. */
    payloadJson: jsonb('payload_json').notNull(),
    makerAdminUserId: uuid('maker_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    /**
     * Null until decided. Equal to the maker ONLY for the config-seeded bootstrap account, whose
     * exemption exists so the first grant is possible at all — and it is written rather than
     * omitted so a reader can see the exception was used instead of inferring it.
     */
    checkerAdminUserId: uuid('checker_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'restrict',
    }),
    reason: text('reason'),
    decisionReason: text('decision_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The inbox read is "what is still waiting", and the sweep reads the same shape.
    byStatus: index('admin_approvals_by_status').on(t.status, t.expiresAt),
  }),
);

/**
 * One in-flight OIDC sign-in attempt: the `state` we sent to Google, the `nonce` we expect back
 * in the ID token, and the PKCE verifier whose challenge went out with the redirect.
 *
 * Server-side rather than a signed cookie, deliberately. A cookie would work, but this table
 * makes single-use enforceable with a row update instead of a replay cache, and an operator
 * debugging a failed staff sign-in can see the attempt. Modelled on `phone_otp_challenges`:
 * short TTL, `consumed_at`, never deleted on use.
 */
export const adminAuthRequests = pgTable('admin_auth_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // SHA-256 of the state parameter, not the state itself. The state is a bearer-ish value that
  // arrives in a URL (and therefore in proxy logs and browser history); storing only its digest
  // means a database read cannot resume somebody else's half-finished sign-in.
  stateHash: text('state_hash').notNull().unique(),
  nonce: text('nonce').notNull(),
  // Plaintext on purpose: PKCE requires us to send the original verifier to Google's token
  // endpoint, so a one-way hash would make it useless. It is single-use and short-lived, and it
  // is worthless without the matching authorization code.
  codeVerifier: text('code_verifier').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A signed-in staff session. Server-side and opaque — there is no admin JWT.
 *
 * Deliberately not `auth_sessions` and deliberately not `sessionService`: that rail mints an
 * HS256 access token carrying an `ActorRole` for the mobile apps, and refreshes the role off the
 * `users` table. Staff have neither. Keeping the two apart also means a stolen customer token can
 * never be presented at the admin surface, whatever a future bug in either does.
 *
 * `token_hash` is a plain SHA-256, NOT argon2 as `auth_sessions.refresh_token_hash` is. The
 * difference is lookup, not laziness: a refresh token arrives alongside a user id, so the row can
 * be found first and the hash verified second. A session cookie arrives alone, so the digest has
 * to be the lookup key — which a salted hash cannot be. The token is 32 random bytes, so there is
 * no dictionary to attack and nothing for a slow KDF to buy.
 */
export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: uuid('admin_user_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
