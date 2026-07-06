import type { VasBillType } from '../../integrations/anchor/types';

export type VasCategory = 'airtime' | 'data' | 'electricity' | 'cabletv';
export type RecipientKind = 'phone' | 'meter' | 'smartcard';

export const VAS_ANCHOR_TYPE: Record<VasCategory, VasBillType> = {
  airtime: 'Airtime',
  data: 'Data',
  electricity: 'Electricity',
  cabletv: 'CableTV',
};

export const VAS_RECIPIENT_KIND: Record<VasCategory, RecipientKind> = {
  airtime: 'phone',
  data: 'phone',
  electricity: 'meter',
  cabletv: 'smartcard',
};

/** Categories that require Anchor customer-validation before payment. */
export const REQUIRES_VALIDATION: Record<VasCategory, boolean> = {
  airtime: false,
  data: false,
  electricity: true,
  cabletv: true,
};

// Confirmed rates (Anchor 2026-06-30). basisPoints of amount, capped. cap=null → uncapped.
export const VAS_COMMISSION: Record<VasCategory, { bps: number; capKobo: bigint | null }> = {
  airtime: { bps: 200, capKobo: null }, // 2%
  data: { bps: 200, capKobo: null }, // 2%
  electricity: { bps: 100, capKobo: 100_000n }, // 1%, cap ₦1,000
  cabletv: { bps: 120, capKobo: 150_000n }, // 1.2%, cap ₦1,500
};
