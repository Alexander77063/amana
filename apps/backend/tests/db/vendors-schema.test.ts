import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorObservations, vendors } from '../../src/db/schema';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';
import { makeHousehold } from '../helpers/vendor-seed';

describe('vendor registry schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('stores an observation keyed by (bank, account, household)', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await testDb.insert(vendorObservations).values({
      bankCode,
      accountNumber,
      householdId,
      accountName: 'MAMA PUT KITCHEN',
    });

    const rows = await testDb.select().from(vendorObservations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settledCount).toBe(1);
    expect(rows[0]?.categoryCounts).toEqual({});
  });

  it('rejects a second vendors row for the same bank account', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const row = {
      bankCode,
      accountNumber,
      displayName: 'MAMA PUT KITCHEN',
      promotedHouseholdCount: 5,
    };
    await testDb.insert(vendors).values(row);
    await expect(testDb.insert(vendors).values(row)).rejects.toThrow();
  });

  it('defaults a new vendor to observed status and observed category source', async () => {
    await testDb.insert(vendors).values({
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOPRITE IKEJA',
      promotedHouseholdCount: 7,
    });
    const [row] = await testDb.select().from(vendors);
    expect(row?.status).toBe('observed');
    expect(row?.categorySource).toBe('observed');
    expect(row?.category).toBeNull();
    expect(row?.publicCode).toBeNull();
  });

  it('households.vendor_category_enforced defaults to NULL (inherit global)', async () => {
    const { householdId } = await makeHousehold(testDb);
    const rows = await testDb.execute<{ vendor_category_enforced: boolean | null }>(
      sql`SELECT vendor_category_enforced FROM households WHERE id = ${householdId}`,
    );
    expect(rows[0]?.vendor_category_enforced).toBeNull();
  });
});
