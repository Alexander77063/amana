import type { Kobo } from '../../lib/kobo';

export type ResolvedVendor = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  /** Where the resolution came from — useful for audit + UX. */
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents';
  /** Optional amount baked in (NQR can include amount; other paths set null). */
  suggestedAmountKobo: Kobo | null;
};

export type ResolveError =
  | { code: 'NOT_FOUND' }
  | { code: 'BAD_INPUT'; message: string }
  | { code: 'PARTNER_DOWN' }
  | { code: 'STICKER_UNBOUND' }
  | { code: 'STICKER_REVOKED' };
