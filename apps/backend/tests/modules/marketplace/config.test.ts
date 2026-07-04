import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_COMMISSION_BPS,
  MARKETPLACE_SPEND_FEE_KOBO,
  VOUCHER_TTL_HOURS,
} from '../../../src/modules/marketplace/config';

describe('marketplace config', () => {
  it('exposes the design-spec defaults', () => {
    expect(MARKETPLACE_COMMISSION_BPS).toBe(500);
    expect(VOUCHER_TTL_HOURS).toBe(168);
  });

  it('spend fee is a bigint kobo, TBD-defaulted to 0', () => {
    expect(typeof MARKETPLACE_SPEND_FEE_KOBO).toBe('bigint');
    expect(MARKETPLACE_SPEND_FEE_KOBO).toBe(0n);
  });
});
