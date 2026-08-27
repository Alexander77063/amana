import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  type VendorConsentPurpose,
  type VendorConsentRow,
  vendorConsentsRepo,
} from './vendor-consents.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * The version of the service terms + privacy notice a claimant is shown.
 *
 * **The text lives at `docs/legal/vendor-claim-terms/<version>.md`**, and
 * `tests/modules/vendors/vendor-terms-text.test.ts` fails if the document for this version is
 * missing. That binding exists because this constant shipped before any text did — the rail
 * enforced acceptance of a version that pointed at nothing, which is a lawful basis on paper and
 * none in fact.
 *
 * A code constant rather than an env var, deliberately: the version is a fact about the text that
 * shipped, not a deployment setting. If it were configurable, two environments could record consent
 * against "v1" meaning two different documents — which is precisely the ambiguity the version exists
 * to remove. **Bump this whenever the text changes**, and understand what that means: everyone who
 * agreed to the old version has NOT agreed to the new one, and `currentState` will show them
 * holding a stale grant.
 */
export const CURRENT_TERMS_VERSION = '2026-08-27.v1';

export type ConsentState = Partial<Record<VendorConsentPurpose, VendorConsentRow>>;

export const vendorConsentService = {
  /** Whether the string a claimant submitted matches the text we would have shown them. */
  isCurrentTermsVersion(version: string | undefined | null): version is string {
    return version === CURRENT_TERMS_VERSION;
  },

  /**
   * Record the consents given at claim time, inside the caller's transaction.
   *
   * `lender_introduction` is written **whichever way the merchant answered**, including when they
   * said no and when they were never asked. A refusal is a fact worth holding: without a row, "we
   * asked and they declined" is indistinguishable from "we never asked", and only the first is
   * evidence you respected the answer.
   */
  async recordClaimConsents(
    db: DbOrTx,
    input: {
      vendorId: string;
      termsVersion: string;
      lenderIntroduction: boolean;
      now: Date;
    },
  ): Promise<void> {
    await vendorConsentsRepo.append(db, {
      vendorId: input.vendorId,
      purpose: 'service_terms',
      granted: true,
      termsVersion: input.termsVersion,
      source: 'claim',
      now: input.now,
    });
    await vendorConsentsRepo.append(db, {
      vendorId: input.vendorId,
      purpose: 'lender_introduction',
      granted: input.lenderIntroduction,
      // The terms version is recorded on the opt-in too: what "introduction" meant is defined by
      // the text that described it, and that text can change.
      termsVersion: input.lenderIntroduction ? input.termsVersion : null,
      source: 'claim',
      now: input.now,
    });
  },

  /**
   * Withdraw one purpose. NDPA requires withdrawal to be as easy as granting.
   *
   * Scoped to a single purpose on purpose: revoking the optional introduction must not disturb the
   * service terms, or withdrawal would cost the merchant their claim — which would make the
   * original consent unfree, and therefore not consent.
   */
  async revoke(
    db: DbOrTx,
    input: { vendorId: string; purpose: VendorConsentPurpose; source: string; now: Date },
  ): Promise<void> {
    await vendorConsentsRepo.append(db, {
      vendorId: input.vendorId,
      purpose: input.purpose,
      granted: false,
      termsVersion: null,
      source: input.source,
      now: input.now,
    });
  },

  /** The latest event per purpose. Absent means never asked, which is not the same as refused. */
  async currentState(db: DbOrTx, vendorId: string): Promise<ConsentState> {
    const state: ConsentState = {};
    for (const purpose of ['service_terms', 'lender_introduction'] as const) {
      const row = await vendorConsentsRepo.latest(db, vendorId, purpose);
      if (row) state[purpose] = row;
    }
    return state;
  },

  /**
   * **The single gate for by-product #1** (`PRICING.md` §8). Every path that would introduce a
   * merchant to a lender asks this and nothing else.
   *
   * Defaults to false in every ambiguous case — never asked, refused, revoked, or an `observed`
   * vendor that never claimed and so was never in a position to agree to anything. There is no
   * argument shape that makes this return true by accident.
   */
  async mayIntroduceToLender(db: DbOrTx, vendorId: string): Promise<boolean> {
    const row = await vendorConsentsRepo.latest(db, vendorId, 'lender_introduction');
    return row?.granted === true;
  },

  /** The full log, newest first — for a subject access request or a dispute. */
  async history(db: DbOrTx, vendorId: string): Promise<VendorConsentRow[]> {
    return vendorConsentsRepo.history(db, vendorId);
  },
};
