import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * What a principal or agent agreed to. Purpose-scoped, like `vendor_consents`.
 *
 * A separate table from `vendor_consents` rather than one polymorphic table, deliberately: a
 * `subject_kind` + `subject_id` pair cannot carry a real foreign key, and every other table in this
 * schema does. Two tables with proper `references()` beat one table with an unenforceable link.
 * The *policy* — append-only, versioned, purpose-scoped — is shared; the storage is not.
 */
export const userConsentPurposeEnum = pgEnum('user_consent_purpose', [
  /**
   * The terms + privacy notice for the user's role. REQUIRED at sign-up. Which document was shown
   * is recorded in `termsVersion`, since principals and agents accept different texts.
   */
  'service_terms',
]);

/**
 * Append-only, exactly as `vendor_consents` is, and for the same reason: the question asked in a
 * dispute is "what had this person agreed to **at the time**", which a mutable flag cannot answer.
 */
export const userConsents = pgTable(
  'user_consents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /**
     * Strict append order, and the only thing `latest` sorts on. `recorded_at` cannot do this job —
     * a grant and a revocation can share a timestamp, and tie-breaking on a random UUID decides by
     * chance. That exact bug shipped in the first draft of `vendor_consents` and is not repeated
     * here.
     */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: userConsentPurposeEnum('purpose').notNull(),
    granted: boolean('granted').notNull(),
    /** Which document was shown. Principals and agents accept different texts and versions. */
    termsVersion: text('terms_version'),
    /**
     * Set when SOMEONE ELSE accepted on this user's behalf — a parent or guardian for a child
     * agent, which NDPA 2023 requires because a child cannot give valid consent themselves.
     *
     * **Not yet wired to any flow.** Who declares an agent a minor, and at what point, is a product
     * decision rather than an engineering one (go-live checklist §8b). The column exists so that
     * when that decision is made the fact is recordable against the specific pairing, rather than
     * being a checkbox in an app that nobody can later evidence.
     */
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    /** 'signup' (the user, at /auth/otp/verify) or 'ops'. Provenance matters when it is examined. */
    source: text('source').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserPurpose: index('user_consents_by_user_purpose').on(t.userId, t.purpose),
  }),
);
