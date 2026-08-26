import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { err, ok } from '../../../src/lib/result';
import { phoneLookupService } from '../../../src/modules/vendors/phone-lookup.service';
import { vendorOwnershipService } from '../../../src/modules/vendors/vendor-ownership.service';

const adapter = {} as AnchorAdapter;
const TARGET = { phone: '+2348012345678', bankCode: '058', accountNumber: '0123456789' };

function mockLookup(bankCode: string, accountNumber: string) {
  return vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(
    ok({
      bankCode,
      accountNumber,
      accountName: 'MUSA ABDULLAHI',
      source: 'phone_lookup',
      suggestedAmountKobo: null,
    }),
  );
}

describe('vendorOwnershipService.proveByPhoneLookup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('proves ownership when NIBSS resolves the phone to the same account', async () => {
    mockLookup('058', '0123456789');
    // The name comes back with the verdict, and that is the point: `vendorClaimService.verify`
    // writes it onto `vendors.display_name`, which is what the public `/v/:code` page renders.
    // Without it the claim would have no bank-confirmed name to publish and would keep the
    // client-supplied observed one.
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: true,
      proof: 'phone_lookup',
      accountName: 'MUSA ABDULLAHI',
    });
  });

  it('refuses when the account number differs', async () => {
    mockLookup('058', '9999999999');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'mismatch',
    });
  });

  it('refuses when the bank differs even though the account number matches', async () => {
    mockLookup('011', '0123456789');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'mismatch',
    });
  });

  it('maps a NIBSS miss to not_found and an outage to partner_down', async () => {
    vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'not_found',
    });

    vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(err({ code: 'PARTNER_DOWN' }));
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'partner_down',
    });
  });

  it('maps an unexpected phone-lookup error to bad_input', async () => {
    vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(
      err({ code: 'BAD_INPUT', message: 'phone not in E.164 format: +234801234567' }),
    );
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'bad_input',
    });
  });
});
