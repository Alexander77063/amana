import type { DenialReason, MerchantRuleConfig, TxnIntent } from '../types';

/**
 * The control fusion: may this sub-wallet buy from this retailer?
 *
 * Allowlist only, by design (see `MerchantRuleConfig`). Two consequences are worth stating
 * outright, because both are the safe direction and both would be easy to get backwards:
 *
 * - An intent with **no retailer** — every bank transfer, VAS top-up and direct spend — is denied.
 *   "Only these merchants" cannot sensibly permit a payment to someone who is not a merchant at
 *   all. That is why a merchant rule is only ever evaluated on the marketplace path.
 * - An **empty** list denies everything. A principal who has approved nobody has approved nobody;
 *   reading that as "approve all" would turn an unfinished setup into an open wallet.
 */
export function evaluateMerchant(cfg: MerchantRuleConfig, intent: TxnIntent): DenialReason | null {
  if (intent.retailerId === null) {
    return { code: 'MERCHANT_NOT_ALLOWED', retailerId: null };
  }
  if (!cfg.retailerIds.includes(intent.retailerId)) {
    return { code: 'MERCHANT_NOT_ALLOWED', retailerId: intent.retailerId };
  }
  return null;
}
