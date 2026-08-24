import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ForbiddenError } from '../../lib/errors';
import { otpService } from '../auth/otp.service';
import { sessionService } from '../auth/session.service';
import type { IssuedTokens } from '../auth/types';
import { usersRepo } from '../identity/users.repo';
import { type RetailerRow, retailersRepo } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

export type RetailerVerifyInput = {
  phone: string;
  code: string;
  /** Required only on the very first sign-in, when the owner's user row is created. */
  nin?: string;
};

export type RetailerVerifyResult =
  | { kind: 'verified'; tokens: IssuedTokens; retailer: RetailerRow; userId: string }
  | { kind: 'invalid_code' }
  | { kind: 'too_many_attempts' }
  | { kind: 'nin_required' }
  | { kind: 'no_retailer_for_phone' };

/**
 * Sign-in for the retailer portal.
 *
 * Deliberately the same primitive as every other human login in Amana — phone OTP over Termii,
 * `DEV_OTP_BYPASS_CODE` in dev — rather than a new credential type. A password surface would mean
 * resets, hashing decisions and a second abuse channel, for a population of Nigerian small
 * businesses who already sign in to everything else by SMS code.
 *
 * ## How a retailer comes to have an owner
 *
 * Onboarding is curated: ops create the business (SP4a, admin key) and record the phone number
 * the owner will use. The first successful OTP from that number claims the retailer and creates
 * the owner's user row. There is no self-registration, which is the point — a retailer that
 * nobody vetted must not be able to appear in the marketplace by signing up.
 *
 * Claiming only ever matches rows with **no owner**, so a live retailer cannot be taken over by
 * someone re-registering its contact number; once claimed, that door is closed permanently.
 */
export const retailerAuthService = {
  async requestCode(db: DbOrTx, phone: string) {
    // Note: deliberately does NOT reveal whether the phone belongs to a retailer. Answering that
    // would turn this endpoint into an oracle for which businesses are on the platform and which
    // number runs them.
    return otpService.requestCode(db, { phone, purpose: 'login' });
  },

  async verify(db: DbOrTx, input: RetailerVerifyInput): Promise<RetailerVerifyResult> {
    const v = await otpService.verifyCode(db, { phone: input.phone, code: input.code });
    if (v.kind !== 'verified') {
      return v.kind === 'too_many_attempts'
        ? { kind: 'too_many_attempts' }
        : { kind: 'invalid_code' };
    }

    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      let user = await usersRepo.findByPhone(txDb, input.phone);

      if (user) {
        // A household phone is not a retailer login. Allowing one user row to be both would put a
        // principal's wallet and a retailer's payouts behind a single OTP, and would make the
        // `actor` claim ambiguous for every route that switches on it.
        if (user.role !== 'retailer') throw new ForbiddenError('phone_is_a_household_login');
        const owned = await retailersRepo.findByOwnerUserId(txDb, user.id);
        if (!owned) return { kind: 'no_retailer_for_phone' as const };
        const tokens = await sessionService.issue(txDb, { userId: user.id, role: 'retailer' });
        return { kind: 'verified' as const, tokens, retailer: owned, userId: user.id };
      }

      // First sign-in: there must be an unclaimed retailer ops recorded this number against.
      const claimable = await retailersRepo.findClaimableByContactPhone(txDb, input.phone);
      if (!claimable) return { kind: 'no_retailer_for_phone' as const };
      // NOTE: the code has already been consumed by `verifyCode` above, so this outcome costs
      // the caller their OTP and they must request a new one. That ordering is deliberate.
      // Checking "is a NIN needed?" first would answer it for anyone who asks, with no code at
      // all — turning this endpoint into an oracle for which phone numbers have a retailer
      // waiting to be claimed. The portal avoids the round trip by offering the NIN field up
      // front on first sign-in rather than discovering the requirement here.
      if (!input.nin) return { kind: 'nin_required' as const };

      user = await usersRepo.insert(txDb, {
        role: 'retailer',
        phone: input.phone,
        nin: input.nin,
        // Tier 1 like any other new human. The BUSINESS is verified through Anchor Business KYB,
        // which is a separate track from the owner's personal KYC and is what gates payouts.
        kycTier: '1',
      });

      const claimed = await retailersRepo.attachOwner(txDb, claimable.id, user.id);
      // The guard is on `ownerUserId IS NULL`, so a miss means another sign-in claimed it between
      // the read and the write. Refuse rather than hand out a session scoped to nothing.
      if (!claimed) return { kind: 'no_retailer_for_phone' as const };

      const tokens = await sessionService.issue(txDb, { userId: user.id, role: 'retailer' });
      return { kind: 'verified' as const, tokens, retailer: claimed, userId: user.id };
    });
  },
};
