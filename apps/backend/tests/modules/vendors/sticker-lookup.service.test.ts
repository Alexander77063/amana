import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { stickersRepo } from '../../../src/modules/sticker/stickers.repo';
import { stickerLookupService } from '../../../src/modules/vendors/sticker-lookup.service';
import { isErr, isOk } from '../../../src/lib/result';

describe('stickerLookupService.lookup', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns ResolvedVendor with source=sticker for an active sticker', async () => {
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA ABDULLAHI',
      vendorPhone: factories.phone(),
      status: 'active',
    });
    const result = await stickerLookupService.lookup(testDb, sticker.uuid);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('sticker');
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
    }
  });

  it('NOT_FOUND for unknown sticker', async () => {
    const result = await stickerLookupService.lookup(testDb, factories.txnId());
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('STICKER_UNBOUND for unbound', async () => {
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058', accountNumber: factories.bankAccount(),
      accountName: 'PENDING', vendorPhone: '+0',
      status: 'unbound',
    });
    const result = await stickerLookupService.lookup(testDb, sticker.uuid);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('STICKER_UNBOUND');
  });

  it('STICKER_REVOKED for revoked', async () => {
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058', accountNumber: factories.bankAccount(),
      accountName: 'OLD', vendorPhone: factories.phone(),
      status: 'revoked',
    });
    const result = await stickerLookupService.lookup(testDb, sticker.uuid);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('STICKER_REVOKED');
  });
});
