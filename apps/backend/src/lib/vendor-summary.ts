import type { VendorRow } from '../modules/vendors/vendors.repo';

export type VendorSummary = {
  id: string;
  displayName: string;
  bankCode: string;
  /** Last four digits only. Ops never needs the full number; the claim already carries the bank identity. */
  accountNumberMasked: string;
  status: VendorRow['status'];
  category: string | null;
  categorySource: VendorRow['categorySource'];
  publicCode: string | null;
  promotedHouseholdCount: number;
  promotedAt: string;
  claimedAt: string | null;
};

export function maskAccount(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

export function vendorSummary(v: VendorRow): VendorSummary {
  return {
    id: v.id,
    displayName: v.displayName,
    bankCode: v.bankCode,
    accountNumberMasked: maskAccount(v.accountNumber),
    status: v.status,
    category: v.category,
    categorySource: v.categorySource,
    publicCode: v.publicCode,
    promotedHouseholdCount: v.promotedHouseholdCount,
    promotedAt: v.promotedAt.toISOString(),
    claimedAt: v.claimedAt?.toISOString() ?? null,
  };
}
