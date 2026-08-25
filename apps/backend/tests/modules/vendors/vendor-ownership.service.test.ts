import { describe, expect, it, vi } from 'vitest';
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
  it('proves ownership when NIBSS resolves the phone to the same account', async () => {
    const spy = mockLookup('058', '0123456789');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: true,
      proof: 'phone_lookup',
    });
    spy.mockRestore();
  });

  it('refuses when the account number differs', async () => {
    const spy = mockLookup('058', '9999999999');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'mismatch',
    });
    spy.mockRestore();
  });

  it('refuses when the bank differs even though the account number matches', async () => {
    const spy = mockLookup('011', '0123456789');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'mismatch',
    });
    spy.mockRestore();
  });

  it('maps a NIBSS miss to not_found and an outage to partner_down', async () => {
    const miss = vi
      .spyOn(phoneLookupService, 'lookup')
      .mockResolvedValue(err({ code: 'NOT_FOUND' }));
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'not_found',
    });
    miss.mockRestore();

    const down = vi
      .spyOn(phoneLookupService, 'lookup')
      .mockResolvedValue(err({ code: 'PARTNER_DOWN' }));
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false,
      reason: 'partner_down',
    });
    down.mockRestore();
  });
});
