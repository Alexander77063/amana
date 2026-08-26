import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { err, isErr, isOk, ok } from '../../../src/lib/result';
import { nameEnquiryService } from '../../../src/modules/vendors/name-enquiry.service';
import { vendorCodeLookupService } from '../../../src/modules/vendors/vendor-code-lookup.service';
import { type VendorRow, vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-10T10:00:00Z');
const adapter = {} as AnchorAdapter;
const CODE = 'AMNV-7QK2H-9PZ0R';

async function aClaimedVendor(code = CODE): Promise<VendorRow> {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  const claimed = await vendorsRepo.claim(testDb, {
    vendorId: v.id,
    phone: factories.phone(),
    category: 'food',
    publicCode: code,
    now: NOW,
  });
  if (!claimed) throw new Error('claim failed');
  return claimed;
}

function mockNameEnquiry(accountName: string) {
  return vi.spyOn(nameEnquiryService, 'lookup').mockImplementation(async (_a, input) =>
    ok({
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountName,
      source: 'name_enquiry' as const,
      suggestedAmountKobo: null,
      vendorId: null,
      category: null,
    }),
  );
}

describe('vendorCodeLookupService.lookup', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('resolves a claimed code, carrying the registry identity and category', async () => {
    const v = await aClaimedVendor();
    const spy = mockNameEnquiry('MAMA PUT KITCHEN');

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value).toEqual({
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      accountName: 'MAMA PUT KITCHEN',
      source: 'vendor_code',
      suggestedAmountKobo: null,
      vendorId: v.id,
      category: 'food',
    });
    // The enquiry must be for THIS vendor's account — an enquiry against the wrong account would
    // still return a name, and every other assertion here would still pass.
    expect(spy).toHaveBeenCalledWith(adapter, {
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
    });
  });

  it('prefers the LIVE NIBSS name over the stored display name', async () => {
    await aClaimedVendor();
    mockNameEnquiry('MAMA PUT KITCHEN LTD'); // the business renamed at the bank

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    if (!isOk(r)) throw new Error('expected ok');
    expect(r.value.accountName).toBe('MAMA PUT KITCHEN LTD');
  });

  it('NOT_FOUNDs an unknown code', async () => {
    const r = await vendorCodeLookupService.lookup(testDb, adapter, 'AMNV-ZZZZZ-ZZZZZ');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('refuses a suspended vendor with its own error code, distinct from an unknown code', async () => {
    const v = await aClaimedVendor();
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('VENDOR_SUSPENDED');

    // The row is deliberately still findable with its code — a suspended vendor keeps its
    // publicCode so a later surface can tell "this code was real and is now dead" apart from
    // "this code never existed". The distinction belongs to the caller, so it must survive the
    // repo layer and only be refused at the resolution layer.
    const stillThere = await vendorsRepo.findByPublicCode(testDb, CODE);
    expect(stillThere?.id).toBe(v.id);

    const unknown = await vendorCodeLookupService.lookup(testDb, adapter, 'AMNV-ZZZZZ-ZZZZZ');
    if (!isErr(unknown)) throw new Error('expected err');
    expect(unknown.error.code).toBe('NOT_FOUND');
    expect(unknown.error.code).not.toBe(isErr(r) ? r.error.code : null);
  });

  it('never leaks the claimant phone or any other unnamed column of the vendor row', async () => {
    const v = await aClaimedVendor();
    expect(v.claimedByPhone).toBeTruthy(); // guard: the seed really did store a raw number
    mockNameEnquiry('MAMA PUT KITCHEN');

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    if (!isOk(r)) throw new Error('expected ok');

    expect(JSON.stringify(r.value)).not.toContain(v.claimedByPhone);
    expect(Object.keys(r.value).sort()).toEqual([
      'accountName',
      'accountNumber',
      'bankCode',
      'category',
      'source',
      'suggestedAmountKobo',
      'vendorId',
    ]);
  });

  it('distinguishes a real code whose bank account is gone from a code that never existed', async () => {
    await aClaimedVendor();
    // Anchor 404s the account: name-enquiry maps that to NOT_FOUND, which is right for a TYPED
    // account number but wrong here, where findByPublicCode has already proven the code is real.
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));

    const gone = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    expect(isErr(gone)).toBe(true);
    if (!isErr(gone)) return;
    expect(gone.error.code).toBe('VENDOR_ACCOUNT_GONE');

    // It must be distinguishable from BOTH neighbouring failures, or the shopkeeper debugs the
    // code in their window while the closed bank account is the actual problem.
    expect(gone.error.code).not.toBe('NOT_FOUND');
    expect(gone.error.code).not.toBe('VENDOR_SUSPENDED');
  });

  it('still NOT_FOUNDs an unknown code when NIBSS would also 404 — the code never existed', async () => {
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));

    const r = await vendorCodeLookupService.lookup(testDb, adapter, 'AMNV-ZZZZZ-ZZZZZ');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('resolves a code typed in lower case or with the ambiguous glyphs', async () => {
    const v = await aClaimedVendor('AMNV-10K2H-9PZ0R');
    mockNameEnquiry('MAMA PUT KITCHEN');

    for (const typed of ['amnv-10k2h-9pz0r', 'AMNV-I0K2H-9PZOR', 'amnv-l0k2h-9pz0r']) {
      const r = await vendorCodeLookupService.lookup(testDb, adapter, typed);
      if (!isOk(r)) throw new Error(`expected ok for ${typed}`);
      expect(r.value.vendorId).toBe(v.id);
    }

    // A U is not a code character and must not be coerced into a hit.
    const withU = await vendorCodeLookupService.lookup(testDb, adapter, 'AMNV-U0K2H-9PZ0R');
    expect(isErr(withU)).toBe(true);
    if (isErr(withU)) expect(withU.error.code).toBe('NOT_FOUND');
  });

  it('propagates a NIBSS outage rather than paying out of a stale stored name', async () => {
    await aClaimedVendor();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'PARTNER_DOWN' }));

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PARTNER_DOWN');
  });
});
