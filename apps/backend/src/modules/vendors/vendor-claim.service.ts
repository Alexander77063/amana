import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
// The connection POOL, not the caller's handle — see the comment at the `runInBackground` call
// below for why the detached OTP send must not depend on the caller's transaction lifetime.
import { db as pool } from '../../db/client';
import { env } from '../../env';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { runInBackground } from '../../lib/background';
import { mintPrefixedCode } from '../../lib/crockford';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { otpService } from '../auth/otp.service';
import { vendorClaimsRepo } from './vendor-claims.repo';
import { CURRENT_TERMS_VERSION, vendorConsentService } from './vendor-consent.service';
import { vendorOwnershipService } from './vendor-ownership.service';
import { vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export type ClaimRequestResult = { accepted: boolean };

export type ClaimVerifyResult =
  | { kind: 'claimed'; publicCode: string; displayName: string }
  | { kind: 'invalid_code' }
  | { kind: 'too_many_attempts' }
  /**
   * The claimant did not accept the current service terms, so there is no lawful basis to claim
   * (NDPA 2023). Decided BEHIND the verified OTP like every other plain answer here, and kept
   * distinct because it is the one outcome the caller can actually fix by trying again.
   */
  | { kind: 'terms_not_accepted'; requiredVersion: string }
  /**
   * The vendor stopped being claimable between `/request` and here — suspended, already claimed,
   * or the `claim` compare-and-set lost a race. Reached only from BEHIND a verified OTP, so
   * telling the caller what happened reveals nothing to anyone who has not already proved control
   * of the phone.
   *
   * The former `no_attempt` kind is gone: with the account named at `/verify` (GATE 3) there is no
   * pre-OTP lookup left that could fail, so the state cannot arise.
   */
  | { kind: 'vendor_unavailable' }
  | { kind: 'ownership_unproved'; reason: string }
  | { kind: 'partner_down' };

/**
 * Last four digits only — enough to recognise a number in the audit log, useless if leaked.
 * Exported so `routes/vendors-admin.ts`'s `approve-claim` writes the identical shape rather than
 * a second, subtly different hash — the audit log is read far more widely than the vendors table.
 */
export function phoneFingerprint(phone: string): string {
  const tail = phone.slice(-4);
  const digest = createHash('sha256').update(phone).digest('hex').slice(0, 8);
  return `***${tail}:${digest}`;
}

export const vendorClaimService = {
  /**
   * Begin a claim: prove you hold this phone.
   *
   * **Takes a phone and nothing else, and ALWAYS sends a code** (PRE-LAUNCH GATE 3). No account is
   * named here, so nothing about the registry can decide whether an SMS goes out.
   *
   * That decision was the leak. The HTTP response was always a uniform 202 — but the code went to
   * the CALLER-SUPPLIED phone, and only when the account resolved to a promoted, unclaimed vendor.
   * So an attacker submitted their OWN number against someone else's account and watched their
   * handset: one request, no Anchor call, and an unambiguous yes to "at least
   * VENDOR_REGISTRY_MIN_HOUSEHOLDS Amana households have paid this account and nobody has claimed
   * it". No amount of response shaping could close that, because the SMS is not part of the
   * response.
   *
   * Naming the account at `/verify` instead puts every account-dependent answer BEHIND proof of
   * phone control — which is what lets the honest owner keep a plain `409` telling them to contact
   * support. Proving ownership at `/request` would have closed the same channel by replacing that
   * 409 with silence, and this runbook records that mismatch (staff phone, a director's line, a
   * changed number) as the common case rather than the edge case.
   *
   * This does not widen the platform's SMS surface: `/auth/otp/request` already sends a code to
   * any phone string a caller supplies, under the same per-phone and per-IP limiters.
   */
  async request(db: DbOrTx, input: { phone: string; now: Date }): Promise<ClaimRequestResult> {
    // Detached for the same reason it always was: an awaited Termii round trip is a timing
    // channel. There is no longer a branch for it to leak, but the latency shape of the endpoint
    // should not depend on the SMS provider either.
    runInBackground(otpService.requestCode(pool, { phone: input.phone, purpose: 'vendor_claim' }));
    return { accepted: true };
  },

  /**
   * Complete a claim: OTP first, then the account, then ownership, then the state change.
   *
   * **The account is named HERE, not at `/request`** (PRE-LAUNCH GATE 3). Everything that depends
   * on it — including whether it is in the registry at all — is therefore decided behind proof of
   * phone control, where it can be answered plainly instead of being leaked by whether an SMS
   * arrived.
   *
   * The order also matters for cost: ownership proof is a paid Anchor call, so it runs only after
   * the OTP has established that the caller controls the phone. A junk code never reaches it.
   *
   * Residual, and deliberately so: a caller who DOES control a phone can still tell
   * `vendor_unavailable` from `ownership_unproved` and so probe registry membership one account at
   * a time. That is the dearer of the two channels the runbook describes — it costs an OTP round
   * trip per probe and is bounded by the per-phone limiter — and closing it means collapsing the
   * two, which takes the actionable answer away from the honest owner. See GATE 3's residual note.
   */
  async verify(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: {
      phone: string;
      code: string;
      bankCode: string;
      accountNumber: string;
      category: string | null;
      /** The terms version the claimant was shown and accepted. Required — see the check below. */
      acceptedTermsVersion?: string;
      /** Optional, defaults to false. Refusing it must cost the claimant nothing. */
      consentToLenderIntroduction?: boolean;
      now: Date;
    },
  ): Promise<ClaimVerifyResult> {
    // FIRST, before anything account-shaped is touched. `allowedPurposes` is required (purpose
    // binding, GATE 1) — a login OTP must not complete a claim, and a claim OTP must not complete
    // a login. `wrong_purpose` collapses into the same answer as a wrong code: the caller learns
    // that it failed, not which of the two ways.
    const otp = await otpService.verifyCode(db, {
      phone: input.phone,
      code: input.code,
      allowedPurposes: ['vendor_claim'],
    });
    if (otp.kind === 'too_many_attempts') return { kind: 'too_many_attempts' };
    if (otp.kind !== 'verified') return { kind: 'invalid_code' };

    // Immediately after the OTP and BEFORE anything account-shaped, for three reasons: it is free
    // where the ownership proof below is a paid Anchor call, so a claim that cannot succeed never
    // buys one; it is the one outcome here the caller can fix by retrying; and answering it before
    // the account is examined means it reveals nothing about the account — a caller without terms
    // learns only that they need terms.
    if (!vendorConsentService.isCurrentTermsVersion(input.acceptedTermsVersion)) {
      return { kind: 'terms_not_accepted', requiredVersion: CURRENT_TERMS_VERSION };
    }
    // Captured: the narrowing above does not survive into the transaction closure, and a non-null
    // assertion there would discard the one check that establishes the lawful basis.
    const acceptedTermsVersion = input.acceptedTermsVersion;

    // Past this line the caller has proved they hold the phone, so the answers may be plain.
    const vendor = await vendorsRepo.findByAccount(db, input.bankCode, input.accountNumber);
    if (!vendor || vendor.status !== 'observed') return { kind: 'vendor_unavailable' };

    // The attempt row is created only NOW — after proof — which is what stops the ops queue
    // filling with unproven land-grabs, and is the structural reason GATE 2's race cannot come
    // back through this door.
    const expiresAt = new Date(input.now.getTime() + env.VENDOR_CLAIM_TTL_SECONDS * 1000);
    const attempt = await vendorClaimsRepo.openAttempt(db, {
      vendorId: vendor.id,
      phone: input.phone,
      expiresAt,
      now: input.now,
    });
    if (!attempt) return { kind: 'vendor_unavailable' };

    const verdict = await vendorOwnershipService.proveByPhoneLookup(adapter, {
      phone: input.phone,
      bankCode: vendor.bankCode,
      accountNumber: vendor.accountNumber,
    });
    if (!verdict.proved) {
      if (verdict.reason === 'partner_down') return { kind: 'partner_down' };
      // The attempt stays pending so an ops operator can approve it by hand (Task 7). A refused
      // proof is the ops queue's inbox, not a dead end.
      return { kind: 'ownership_unproved', reason: verdict.reason };
    }

    const publicCode = mintPrefixedCode('AMNV');
    // The state change is three writes that must land together: a vendor left `claimed` with its
    // attempt still `pending` is a phantom ops-queue entry for a business that no longer needs
    // review, and a claim with no audit row is an ownership transfer with no trail. Ownership
    // proof and OTP verification stay OUTSIDE this transaction deliberately — they are slow
    // external/pre-checked calls, and a Postgres error here must not be able to unwind either.
    const claimed = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const claimedRow = await vendorsRepo.claim(txDb, {
        vendorId: vendor.id,
        phone: input.phone,
        category: input.category,
        // The bank's name for the account, from the enquiry that just proved ownership — NOT a
        // second Anchor call, and not the observed name it replaces. Until this write
        // `display_name` was `vendor_observations.account_name`, which came from
        // `vendorResolvedName` on a payer's `POST /transactions/intent`; the claim is the moment
        // that row becomes public identity content on `/v/:code`, so it is also the moment the
        // string has to stop being client-supplied. Inside the existing transaction, as one more
        // column on the write that was already happening.
        displayName: verdict.accountName,
        publicCode,
        now: input.now,
      });
      if (!claimedRow) return null;

      await vendorClaimsRepo.markVerified(txDb, attempt.id, verdict.proof, input.now);
      // Everyone else who had an attempt open on this vendor has just lost it — the vendor is
      // claimed and cannot be claimed again. Closing them here, in the same transaction as the
      // claim, is what keeps "several pending attempts per vendor" from leaving phantom ops-queue
      // rows behind, and stops `findPendingByPhone` handing a dead attempt to a later `/verify`.
      await vendorClaimsRepo.rejectOtherPendingForVendor(txDb, vendor.id, attempt.id);
      // In the SAME transaction as the claim. A vendor that is `claimed` with no consent row is a
      // merchant we are processing without a recorded lawful basis — the exact gap this closes —
      // so the two must not be able to come apart.
      await vendorConsentService.recordClaimConsents(txDb, {
        vendorId: vendor.id,
        termsVersion: acceptedTermsVersion,
        lenderIntroduction: input.consentToLenderIntroduction === true,
        now: input.now,
      });
      await auditRepo.append(txDb, {
        actorKind: 'system',
        action: 'vendor.claimed',
        subjectKind: 'vendor',
        subjectId: vendor.id,
        payloadJson: {
          // Fingerprinted, never the raw number: the audit log is queried far more widely than
          // the vendors table, and a claimant's phone is personal data that has no business
          // spreading.
          claimantPhone: phoneFingerprint(input.phone),
          ownershipProof: verdict.proof,
          category: input.category,
          publicCode,
        },
      });
      return claimedRow;
    });
    // Same reasoning as the check above: the CAS lost a race (someone else claimed the vendor in
    // between), the OTP is already spent, and the caller is behind the verified-OTP gate.
    if (!claimed) return { kind: 'vendor_unavailable' };

    return { kind: 'claimed', publicCode, displayName: claimed.displayName };
  },
};
