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
import { vendors } from './vendors';

/**
 * What a merchant agreed to. One value per PURPOSE, never a single bundled flag.
 *
 * NDPA 2023 (like the GDPR it follows) requires consent to be specific, and treats a consent
 * bundled with a different purpose as no consent at all. So the service terms a merchant must
 * accept to be claimed at all, and the optional agreement to be introduced to a lender, cannot
 * share a column — the second must be refusable without losing the first.
 */
export const vendorConsentPurposeEnum = pgEnum('vendor_consent_purpose', [
  /** Service terms + privacy notice. REQUIRED to claim — without it there is no claim. */
  'service_terms',
  /**
   * Optional. Being introduced to a lender or credit partner on the strength of the payment
   * regularity Amana observes (`PRICING.md` §8, by-product #1). Default OFF, refusing it changes
   * nothing else, and it is independently revocable.
   */
  'lender_introduction',
]);

/**
 * An append-only log of consent EVENTS, not a mutable flag per vendor.
 *
 * Same reasoning as `postings` and `audit_log`: a revocation is a new row, never an UPDATE. The
 * question a regulator or a dispute actually asks is "what had this merchant agreed to **at the
 * time you processed their data**", and a mutable boolean cannot answer it — it only knows the
 * present. `vendorConsentsRepo.currentState` folds the log; the log itself is the evidence.
 *
 * `termsVersion` is recorded per grant because terms change and a grant is only meaningful against
 * the text that was shown. A merchant who agreed to v1 has not agreed to v2.
 */
export const vendorConsents = pgTable(
  'vendor_consents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /**
     * Strict append order, and the ONLY thing `latest` sorts on.
     *
     * `recorded_at` cannot do this job: a grant and its revocation can legitimately share a
     * timestamp — the claim writes both consents with one `now`, and a revocation seconds later
     * can round to the same value under a caller-supplied clock. Tie-breaking on a random
     * `gen_random_uuid()` then decides which one "wins" by chance, which is how the first version
     * of this table passed its tests once and failed them the next run. A sequence is monotonic by
     * construction and answers "which came last" without reference to any clock.
     */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    purpose: vendorConsentPurposeEnum('purpose').notNull(),
    /** true = granted, false = revoked. Both are rows; neither overwrites the other. */
    granted: boolean('granted').notNull(),
    /** The version of the text actually shown. Null on a revocation — you revoke a purpose, not a text. */
    termsVersion: text('terms_version'),
    /**
     * How it was collected: 'claim' (the merchant, at /vendor-claim/verify) or 'ops' (recorded by
     * an operator, e.g. a revocation phoned in). Provenance matters when the evidence is examined.
     */
    source: text('source').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The read is always "latest row for this vendor and purpose", so index the pair.
    byVendorPurpose: index('vendor_consents_by_vendor_purpose').on(t.vendorId, t.purpose),
  }),
);
