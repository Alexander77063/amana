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
import { vendorOwnershipService } from './vendor-ownership.service';
import { vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export type ClaimRequestResult = { accepted: boolean };

export type ClaimVerifyResult =
  | { kind: 'claimed'; publicCode: string; displayName: string }
  | { kind: 'invalid_code' }
  | { kind: 'too_many_attempts' }
  | { kind: 'no_attempt' }
  | { kind: 'ownership_unproved'; reason: string }
  | { kind: 'partner_down' };

/** Last four digits only — enough to recognise a number in the audit log, useless if leaked. */
function phoneFingerprint(phone: string): string {
  const tail = phone.slice(-4);
  const digest = createHash('sha256').update(phone).digest('hex').slice(0, 8);
  return `***${tail}:${digest}`;
}

export const vendorClaimService = {
  /**
   * Begin a claim.
   *
   * **Always resolves `{ accepted: true }`, whatever happens.** A caller must not be able to learn
   * whether an account is in the registry, because that is precisely the aggregate the promotion
   * threshold exists to protect — "has this account been paid by at least five Amana households".
   * The work simply does not happen for an account we do not hold, and no OTP is sent.
   *
   * The *value* returned is a uniform non-oracle, but the code paths leading to it are not
   * equal-cost: an unknown account is one SELECT, an in-flight attempt adds an INSERT, and only
   * the happy path used to also await an outbound Termii SMS round trip. That gap is a timing
   * side-channel that recovers the exact bit the uniform response exists to hide, so the OTP send
   * is detached (`runInBackground`) rather than awaited — the response leaves at the same point
   * in the control flow regardless of whether an SMS goes out behind it.
   */
  async request(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: { bankCode: string; accountNumber: string; phone: string; now: Date },
  ): Promise<ClaimRequestResult> {
    try {
      const vendor = await vendorsRepo.findByAccount(db, input.bankCode, input.accountNumber);
      if (!vendor || vendor.status !== 'observed') return { accepted: true };

      // A phone can only ever be mid-claim on one vendor at a time. Without this check, a caller
      // who does not control the phone (proof only happens at verify) could pile a second pending
      // attempt onto a victim's phone for a different vendor, stranding the victim's real attempt
      // and burning a paid Anchor lookup when it later gets picked non-deterministically. This
      // closes the interleaving where the attacker arrives while a legitimate attempt is already
      // open; it cannot stop an attacker who calls first — that race is bounded by the route's
      // rate limiter (Task 6), not by this check.
      const existingForPhone = await vendorClaimsRepo.findPendingByPhone(
        db,
        input.phone,
        input.now,
      );
      if (existingForPhone && existingForPhone.vendorId !== vendor.id) return { accepted: true };

      const expiresAt = new Date(input.now.getTime() + env.VENDOR_CLAIM_TTL_SECONDS * 1000);
      const attempt = await vendorClaimsRepo.openAttempt(db, {
        vendorId: vendor.id,
        phone: input.phone,
        expiresAt,
      });
      // Null means someone else already has a claim in flight for this vendor. Same response.
      if (!attempt) return { accepted: true };

      // Detached and on the connection pool, not the caller's `db` handle: this call must not
      // block the response (the timing side-channel above), and it must not depend on a
      // transaction the caller might still be holding open or that could later roll back. The
      // task carries its own `.catch` per `runInBackground`'s contract — a send failure is
      // exactly as invisible to the caller as every other failure mode of this method.
      runInBackground(
        otpService.requestCode(pool, { phone: input.phone, purpose: 'vendor_claim' }).catch((e) => {
          logger.warn(
            { err: e instanceof Error ? e.message : String(e) },
            'vendor claim otp send failed',
          );
        }),
      );
      return { accepted: true };
    } catch (e) {
      // Even a failure is invisible to the caller — an error shape would itself be a signal. This
      // is that guarantee's last line of defence (the route has no try/catch of its own), so the
      // log line must never itself throw: `(e as Error).message` on a non-Error rejection would
      // escape this catch and hand the caller a distinguishable 500.
      logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'vendor claim request failed',
      );
      return { accepted: true };
    }
  },

  /**
   * Complete a claim: OTP first, then ownership, then the state change.
   *
   * The order matters for cost as well as security — ownership proof is a paid Anchor call, so it
   * runs only after the OTP has established that the caller controls the phone.
   */
  async verify(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: { phone: string; code: string; category: string | null; now: Date },
  ): Promise<ClaimVerifyResult> {
    const attempt = await vendorClaimsRepo.findPendingByPhone(db, input.phone, input.now);
    if (!attempt) return { kind: 'no_attempt' };

    // `allowedPurposes` is required (purpose binding shipped ahead of SP-V2) — a login OTP must
    // not complete a claim, and a claim OTP must not complete a login. `wrong_purpose` falls into
    // the same response as a wrong code: the caller learns that it failed, not which of the two
    // ways.
    const otp = await otpService.verifyCode(db, {
      phone: input.phone,
      code: input.code,
      allowedPurposes: ['vendor_claim'],
    });
    if (otp.kind === 'too_many_attempts') return { kind: 'too_many_attempts' };
    if (otp.kind !== 'verified') return { kind: 'invalid_code' };

    const vendor = await vendorsRepo.findById(db, attempt.vendorId);
    if (!vendor || vendor.status !== 'observed') return { kind: 'no_attempt' };

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
        publicCode,
        now: input.now,
      });
      if (!claimedRow) return null;

      await vendorClaimsRepo.markVerified(txDb, attempt.id, verdict.proof, input.now);
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
    if (!claimed) return { kind: 'no_attempt' };

    return { kind: 'claimed', publicCode, displayName: claimed.displayName };
  },
};
