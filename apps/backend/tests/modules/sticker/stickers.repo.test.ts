import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { stickersRepo } from '../../../src/modules/sticker/stickers.repo';

describe('vendor_stickers (schema + repo)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('schema columns', async () => {
    const r = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_stickers' ORDER BY ordinal_position
    `);
    expect(r.map((x) => x.column_name)).toEqual([
      'uuid', 'bank_code', 'account_number', 'account_name',
      'vendor_phone', 'status', 'registered_at',
    ]);
  });

  it('insert + findByUuid', async () => {
    const created = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: factories.bankAccount(),
      accountName: 'MUSA ABDULLAHI',
      vendorPhone: factories.phone(),
      status: 'active',
    });
    const found = await stickersRepo.findByUuid(testDb, created.uuid);
    expect(found?.accountName).toBe('MUSA ABDULLAHI');
    expect(found?.status).toBe('active');
  });

  it('setStatus revokes a sticker', async () => {
    const created = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: factories.bankAccount(),
      accountName: 'MUSA ABDULLAHI',
      vendorPhone: factories.phone(),
      status: 'active',
    });
    await stickersRepo.setStatus(testDb, created.uuid, 'revoked');
    const found = await stickersRepo.findByUuid(testDb, created.uuid);
    expect(found?.status).toBe('revoked');
  });
});
