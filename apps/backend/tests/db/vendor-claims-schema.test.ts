import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorClaimAttempts } from '../../src/db/schema';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');

async function aVendor() {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

describe('vendor_claim_attempts schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('defaults a new attempt to pending', async () => {
    const v = await aVendor();
    await testDb.insert(vendorClaimAttempts).values({
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(NOW.getTime() + 900_000),
    });
    const [row] = await testDb.select().from(vendorClaimAttempts);
    expect(row?.status).toBe('pending');
    expect(row?.verifiedAt).toBeNull();
    expect(row?.ownershipProof).toBeNull();
  });

  it('allows only ONE pending attempt per vendor', async () => {
    const v = await aVendor();
    const attempt = {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(NOW.getTime() + 900_000),
    };
    await testDb.insert(vendorClaimAttempts).values(attempt);
    await expect(
      testDb.insert(vendorClaimAttempts).values({ ...attempt, phone: factories.phone() }),
    ).rejects.toThrow();
  });

  it('permits a second attempt once the first is no longer pending', async () => {
    const v = await aVendor();
    const [first] = await testDb
      .insert(vendorClaimAttempts)
      .values({ vendorId: v.id, phone: factories.phone(), expiresAt: NOW })
      .returning();
    if (!first) throw new Error('insert failed');
    await testDb.execute(
      sql`UPDATE vendor_claim_attempts SET status = 'expired' WHERE id = ${first.id}`,
    );
    await expect(
      testDb.insert(vendorClaimAttempts).values({
        vendorId: v.id,
        phone: factories.phone(),
        expiresAt: new Date(NOW.getTime() + 900_000),
      }),
    ).resolves.toBeDefined();
  });
});
