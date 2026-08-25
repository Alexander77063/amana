import { beforeEach, describe, expect, it } from 'vitest';
import { vendors } from '../../../src/db/schema';
import { vendorObservationsRepo } from '../../../src/modules/vendors/vendor-observations.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';
import { makeHousehold } from '../../helpers/vendor-seed';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorObservationsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('records a first observation with count 1 and a one-entry category tally', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await vendorObservationsRepo.record(testDb, {
      bankCode,
      accountNumber,
      householdId,
      accountName: 'MAMA PUT KITCHEN',
      category: 'food',
      now: NOW,
    });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settledCount).toBe(1);
    expect(rows[0]?.categoryCounts).toEqual({ food: 1 });
  });

  it('increments the same household rather than inserting a second row', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const base = { bankCode, accountNumber, householdId, accountName: 'MAMA PUT', now: NOW };

    await vendorObservationsRepo.record(testDb, { ...base, category: 'food' });
    await vendorObservationsRepo.record(testDb, { ...base, category: 'food' });
    await vendorObservationsRepo.record(testDb, { ...base, category: 'transport' });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settledCount).toBe(3);
    expect(rows[0]?.categoryCounts).toEqual({ food: 2, transport: 1 });
  });

  it('records a null category without disturbing an existing tally', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const base = { bankCode, accountNumber, householdId, accountName: 'MAMA PUT', now: NOW };

    await vendorObservationsRepo.record(testDb, { ...base, category: 'food' });
    await vendorObservationsRepo.record(testDb, { ...base, category: null });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows[0]?.settledCount).toBe(2);
    expect(rows[0]?.categoryCounts).toEqual({ food: 1 });
  });

  it('counts DISTINCT HOUSEHOLDS, not payments, against the threshold', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    // One household paying twenty times must NOT reach a threshold of 3.
    const solo = await makeHousehold(testDb);
    for (let i = 0; i < 20; i++) {
      await vendorObservationsRepo.record(testDb, {
        bankCode,
        accountNumber,
        householdId: solo.householdId,
        accountName: 'MAMA PUT',
        category: 'food',
        now: NOW,
      });
    }
    expect(await vendorObservationsRepo.accountsAtOrAboveThreshold(testDb, 3)).toEqual([]);

    // Two more households, one payment each, does.
    for (let i = 0; i < 2; i++) {
      const h = await makeHousehold(testDb);
      await vendorObservationsRepo.record(testDb, {
        bankCode,
        accountNumber,
        householdId: h.householdId,
        accountName: 'MAMA PUT KITCHEN',
        category: 'food',
        now: NOW,
      });
    }
    const found = await vendorObservationsRepo.accountsAtOrAboveThreshold(testDb, 3);
    expect(found).toHaveLength(1);
    expect(found[0]?.householdCount).toBe(3);
    expect(found[0]?.accountName).toBe('MAMA PUT KITCHEN');
  });

  it('prunes stale observations only for accounts with no vendors row', async () => {
    const stale = new Date('2026-01-01T00:00:00Z');
    const promotedAcct = factories.bankAccount();
    const orphanAcct = factories.bankAccount();
    const bankCode = factories.bankCode();

    const h1 = await makeHousehold(testDb);
    const h2 = await makeHousehold(testDb);
    await vendorObservationsRepo.record(testDb, {
      bankCode,
      accountNumber: promotedAcct,
      householdId: h1.householdId,
      accountName: 'SHOP',
      category: 'food',
      now: stale,
    });
    await vendorObservationsRepo.record(testDb, {
      bankCode,
      accountNumber: orphanAcct,
      householdId: h2.householdId,
      accountName: 'A PERSON',
      category: null,
      now: stale,
    });
    await testDb.insert(vendors).values({
      bankCode,
      accountNumber: promotedAcct,
      displayName: 'SHOP',
      promotedHouseholdCount: 5,
    });

    const deleted = await vendorObservationsRepo.pruneStaleUnpromoted(
      testDb,
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(deleted).toBe(1);
    expect(await vendorObservationsRepo.listForAccount(testDb, bankCode, orphanAcct)).toEqual([]);
    expect(
      await vendorObservationsRepo.listForAccount(testDb, bankCode, promotedAcct),
    ).toHaveLength(1);
  });
});
