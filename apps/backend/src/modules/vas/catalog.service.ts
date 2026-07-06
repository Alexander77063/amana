import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import type { VasCategory } from './config';

/**
 * Thin read-only proxy over the Anchor bill catalog. Kept as a service (rather than calling the
 * adapter directly in the route) so the buyer-facing catalog surface has one seam to shape/cache
 * later. The adapter is passed in — no module singleton here — mirroring `vasPurchaseService.create`.
 */
export const vasCatalogService = {
  listBillers: (adapter: AnchorAdapter, category: VasCategory) => adapter.listBillers(category),
  listProducts: (adapter: AnchorAdapter, billerId: string) => adapter.listProducts(billerId),
  validateCustomer: (adapter: AnchorAdapter, providerSlug: string, account: string) =>
    adapter.validateCustomer(providerSlug, account),
};
