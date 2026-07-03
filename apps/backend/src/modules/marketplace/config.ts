import { env } from '../../env';
import { type Kobo, kobo } from '../../lib/kobo';

/**
 * Marketplace money constants (SP1 voucher/redemption ledger core). All values are sourced from
 * `env.ts` (Zod-validated at boot) with the design-spec defaults, so they can be tuned per
 * environment without a code change.
 */

/** Amana's commission on a redeemed purchase, in basis points (500 = 5%). */
export const MARKETPLACE_COMMISSION_BPS: number = env.MARKETPLACE_COMMISSION_BPS;

/** Voucher hold lifetime before the expiry sweep auto-refunds it (168h = 7 days). */
export const VOUCHER_TTL_HOURS: number = env.VOUCHER_TTL_HOURS;

/**
 * Per-spend fee charged on a marketplace redemption, in kobo. TBD pending the pricing pass;
 * defaults to 0 so a discounted purchase is never double-charged on top of commission.
 */
export const MARKETPLACE_SPEND_FEE_KOBO: Kobo = kobo(BigInt(env.MARKETPLACE_SPEND_FEE_KOBO));
