import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { stickersRepo } from '../../../src/modules/sticker/stickers.repo';
import { stickerResolverService } from '../../../src/modules/sticker/sticker-resolver.service';
import { isErr, isOk } from '../../../src/lib/result';

describe('stickerResolverService.resolve', () => {
  beforeEach(async () => { await truncateAll(); });

  it('resolves an active sticker to its bank account', async () => {
    const created = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA ABDULLAHI',
      vendorPhone: factories.phone(),
      status: 'active',
    });
    const result = await stickerResolverService.resolve(testDb, created.uuid);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.bankCode).toBe('058');
      expect(result.value.accountNumber).toBe('0123456789');
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
    }
  });

  it('returns NOT_FOUND for an unknown sticker', async () => {
    const result = await stickerResolverService.resolve(testDb, factories.txnId());
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns UNBOUND for a sticker that hasnt been claimed yet', async () => {
    const created = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: factories.bankAccount(),
      accountName: 'PENDING',
      vendorPhone: '+0000000000',
      status: 'unbound',
    });
    const result = await stickerResolverService.resolve(testDb, created.uuid);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('UNBOUND');
    }
  });

  it('returns REVOKED for a revoked sticker', async () => {
    const created = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: factories.bankAccount(),
      accountName: 'OLD VENDOR',
      vendorPhone: factories.phone(),
      status: 'revoked',
    });
    const result = await stickerResolverService.resolve(testDb, created.uuid);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('REVOKED');
    }
  });
});
