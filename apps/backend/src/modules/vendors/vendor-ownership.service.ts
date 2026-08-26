import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { isOk } from '../../lib/result';
import { phoneLookupService } from './phone-lookup.service';

/**
 * `accountName` is REQUIRED on the proved branch, not optional.
 *
 * It is the bank's own name for the account, and `vendorClaimService.verify` writes it straight
 * onto `vendors.display_name` — the string the unauthenticated `/v/:code` page renders under a
 * "Verified on Amana" badge. Making it required means a caller (or a test double) that forgets it
 * is a compile error rather than a `null` landing in a `notNull` column, and it means the only way
 * to reach a proved verdict is to have actually asked NIBSS.
 *
 * It is safe to treat as the claimed account's name specifically, not merely "some name the phone
 * is attached to": the verdict is only `proved` when the looked-up bank code AND account number
 * both equal the vendor's, so the row this name came from IS the vendor's account.
 */
export type OwnershipVerdict =
  | { proved: true; proof: 'phone_lookup'; accountName: string }
  | { proved: false; reason: 'mismatch' | 'not_found' | 'partner_down' | 'bad_input' };

export const vendorOwnershipService = {
  /**
   * Prove that a phone and a bank account belong to the same person.
   *
   * NIBSS phone lookup resolves a number to its primary BVN-linked account. If that comes back as
   * the very account being claimed, the phone and the account share a BVN — which, paired with an
   * OTP proving the claimant controls the phone, is a solid claim built entirely from calls the
   * platform already makes.
   *
   * Both the bank code and the account number must match. Account numbers are only ten digits and
   * are not unique across banks, so comparing the number alone would accept a different person's
   * account at a different institution.
   */
  async proveByPhoneLookup(
    adapter: AnchorAdapter,
    input: { phone: string; bankCode: string; accountNumber: string },
  ): Promise<OwnershipVerdict> {
    const r = await phoneLookupService.lookup(adapter, { phoneNumber: input.phone });
    if (!isOk(r)) {
      switch (r.error.code) {
        case 'NOT_FOUND':
          return { proved: false, reason: 'not_found' };
        case 'PARTNER_DOWN':
          return { proved: false, reason: 'partner_down' };
        default:
          return { proved: false, reason: 'bad_input' };
      }
    }
    const matches =
      r.value.bankCode === input.bankCode && r.value.accountNumber === input.accountNumber;
    return matches
      ? { proved: true, proof: 'phone_lookup', accountName: r.value.accountName }
      : { proved: false, reason: 'mismatch' };
  },
};
