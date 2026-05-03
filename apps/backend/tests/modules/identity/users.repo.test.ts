import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { usersRepo } from '../../../src/modules/identity/users.repo';

describe('users (schema + repo)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id', 'role', 'phone', 'bvn', 'nin', 'kyc_tier', 'status', 'created_at',
    ]);
  });

  it('rejects duplicate phones', async () => {
    await usersRepo.insert(testDb, {
      role: 'principal', phone: '+2348011111111', nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    await expect(
      usersRepo.insert(testDb, {
        role: 'agent', phone: '+2348011111111', nin: factories.nin(), kycTier: '1',
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('insert + findById round-trips', async () => {
    const created = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const fetched = await usersRepo.findById(testDb, created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.kycTier).toBe('2');
  });

  it('findByPhone resolves the same row', async () => {
    const phone = factories.phone();
    const created = await usersRepo.insert(testDb, {
      role: 'agent', phone, nin: factories.nin(), kycTier: '1',
    });
    const fetched = await usersRepo.findByPhone(testDb, phone);
    expect(fetched?.id).toBe(created.id);
  });

  it('setStatus updates the user', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    await usersRepo.setStatus(testDb, u.id, 'suspended');
    const fetched = await usersRepo.findById(testDb, u.id);
    expect(fetched?.status).toBe('suspended');
  });

  it('setKycTier updates the user', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    await usersRepo.setKycTier(testDb, u.id, '3');
    const fetched = await usersRepo.findById(testDb, u.id);
    expect(fetched?.kycTier).toBe('3');
  });
});
