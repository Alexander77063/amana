import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
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
   */
  async request(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: { bankCode: string; accountNumber: string; phone: string; now: Date },
  ): Promise<ClaimRequestResult> {
    try {
      const vendor = await vendorsRepo.findByAccount(db, input.bankCode, input.accountNumber);
      if (!vendor || vendor.status !== 'observed') return { accepted: true };

      const expiresAt = new Date(input.now.getTime() + env.VENDOR_CLAIM_TTL_SECONDS * 1000);
      const attempt = await vendorClaimsRepo.openAttempt(db, {
        vendorId: vendor.id,
        phone: input.phone,
        expiresAt,
      });
      // Null means someone else already has a claim in flight for this vendor. Same response.
      if (!attempt) return { accepted: true };

      await otpService.requestCode(db, { phone: input.phone, purpose: 'vendor_claim' });
      return { accepted: true };
    } catch (e) {
      // Even a failure is invisible to the caller — an error shape would itself be a signal.
      logger.warn({ err: (e as Error).message }, 'vendor claim request failed');
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
    const claimed = await vendorsRepo.claim(db, {
      vendorId: vendor.id,
      phone: input.phone,
      category: input.category,
      publicCode,
      now: input.now,
    });
    if (!claimed) return { kind: 'no_attempt' };

    await vendorClaimsRepo.markVerified(db, attempt.id, verdict.proof, input.now);
    await auditRepo.append(db, {
      actorKind: 'system',
      action: 'vendor.claimed',
      subjectKind: 'vendor',
      subjectId: vendor.id,
      payloadJson: {
        // Fingerprinted, never the raw number: the audit log is queried far more widely than the
        // vendors table, and a claimant's phone is personal data that has no business spreading.
        claimantPhone: phoneFingerprint(input.phone),
        ownershipProof: verdict.proof,
        category: input.category,
        publicCode,
      },
    });

    return { kind: 'claimed', publicCode, displayName: claimed.displayName };
  },
};
