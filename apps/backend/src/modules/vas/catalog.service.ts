import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { VAS_ANCHOR_TYPE, type VasCategory } from './config';

/**
 * Thin read-only proxy over the Anchor bill catalog. Kept as a service (rather than calling the
 * adapter directly in the route) so the buyer-facing catalog surface has one seam to shape/cache
 * later. The adapter is passed in — no module singleton here — mirroring `vasPurchaseService.create`.
 */
export const vasCatalogService = {
  /**
   * Anchor names its bill types `Airtime` / `Data` / `Electricity` / `CableTV`; ours are
   * lowercase. The purchase path has always mapped through `VAS_ANCHOR_TYPE` — this did not,
   * so the catalog was queried with a category Anchor does not use and came back empty. That
   * left the app with no providers to choose from.
   */
  listBillers: (adapter: AnchorAdapter, category: VasCategory) =>
    adapter.listBillers(VAS_ANCHOR_TYPE[category]),
  listProducts: (adapter: AnchorAdapter, billerId: string) => adapter.listProducts(billerId),
  validateCustomer: (adapter: AnchorAdapter, providerSlug: string, account: string) =>
    adapter.validateCustomer(providerSlug, account),
};
