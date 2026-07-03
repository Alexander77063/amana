import { beforeEach, describe, expect, it } from 'vitest';
import { transactions } from '../../../src/db/schema';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { redemptionsRepo } from '../../../src/modules/marketplace/redemptions.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedContext() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { principalId: principal.id, agentId: agent.id, masterId: mw.master.id, subId: sw.sub.id };
}

// Seed a marketplace_purchase transaction to satisfy the redemption's FK.
async function seedTxn(masterId: string, subId: string | null): Promise<string> {
  const [txn] = await testDb
    .insert(transactions)
    .values({
      masterWalletId: masterId,
      subWalletId: subId,
      kind: 'marketplace_purchase',
      amountKobo: kobo(9_000n),
      idempotencyKey: factories.idempotencyKey(),
    })
    .returning();
  if (!txn) throw new Error('seedTxn: no row');
  return txn.id;
}

let seq = 0;
async function insertRedemption(
  ctx: { agentId: string; masterId: string; subId: string | null },
  overrides: Partial<{
    code: string;
    qrToken: string;
    status: 'reserved' | 'redeemed' | 'expired' | 'refunded';
    expiresAt: Date;
    buyerUserId: string;
  }> = {},
) {
  const txnId = await seedTxn(ctx.masterId, ctx.subId);
  const n = ++seq;
  return redemptionsRepo.insert(testDb, {
    transactionId: txnId,
    buyerUserId: overrides.buyerUserId ?? ctx.agentId,
    masterWalletId: ctx.masterId,
    subWalletId: ctx.subId,
    retailerId: 'retailer-1',
    catalogItemId: 'item-1',
    dealId: null,
    grossKobo: kobo(10_000n),
    discountedKobo: kobo(9_000n),
    commissionKobo: kobo(450n),
    code: overrides.code ?? `AMN-SEED-${String(n).padStart(4, '0')}`,
    qrToken: overrides.qrToken ?? `qr-seed-${n}`,
    expiresAt: overrides.expiresAt ?? new Date('2026-07-10T00:00:00Z'),
    status: overrides.status,
  });
}

describe('redemptions.repo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert defaults status=reserved and round-trips via findById', async () => {
    const ctx = await seedContext();
    const created = await insertRedemption(ctx);
    expect(created.status).toBe('reserved');
    expect(created.discountedKobo).toBe(9_000n);
    expect(created.redeemedAt).toBeNull();

    const found = await redemptionsRepo.findById(testDb, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.commissionKobo).toBe(450n);
  });

  it('findByCodeForUpdate returns the row by code', async () => {
    const ctx = await seedContext();
    const created = await insertRedemption(ctx, { code: 'AMN-CODE-0001' });
    const found = await redemptionsRepo.findByCodeForUpdate(testDb, 'AMN-CODE-0001');
    expect(found?.id).toBe(created.id);
    expect(await redemptionsRepo.findByCodeForUpdate(testDb, 'AMN-NOPE-0000')).toBeUndefined();
  });

  it('findByCodeForUpdate row-locks: a concurrent tx blocks until the first commits', async () => {
    const ctx = await seedContext();
    const code = 'AMN-LOCK-0001';
    await insertRedemption(ctx, { code, qrToken: 'qr-lock-1' });

    const events: string[] = [];
    let signalLocked!: () => void;
    const locked = new Promise<void>((res) => {
      signalLocked = res;
    });
    let allowRelease!: () => void;
    const canRelease = new Promise<void>((res) => {
      allowRelease = res;
    });

    const tx1 = testDb.transaction(async (tx) => {
      await redemptionsRepo.findByCodeForUpdate(tx, code); // acquires FOR UPDATE lock
      signalLocked();
      await canRelease; // hold the lock open until tx2 is confirmed waiting
      events.push('tx1-release');
    });

    const tx2 = (async () => {
      await locked; // barrier: only attempt once tx1 holds the lock
      const blocked = testDb.transaction(async (tx) => {
        await redemptionsRepo.findByCodeForUpdate(tx, code); // blocks on tx1's lock
        events.push('tx2-acquired');
      });
      // tx2 is now blocking on the row lock; release tx1 so it can commit.
      setTimeout(() => allowRelease(), 40);
      await blocked;
    })();

    await Promise.all([tx1, tx2]);
    expect(events).toEqual(['tx1-release', 'tx2-acquired']);
  });

  it('findByBuyer returns only that buyer, newest first', async () => {
    const ctx = await seedContext();
    await insertRedemption(ctx, { code: 'AMN-BUY-0001' });
    await insertRedemption(ctx, { code: 'AMN-BUY-0002' });
    // A different buyer (the principal) — must not leak.
    await insertRedemption(ctx, { code: 'AMN-BUY-0003', buyerUserId: ctx.principalId });

    const mine = await redemptionsRepo.findByBuyer(testDb, ctx.agentId);
    expect(mine.map((r) => r.code).sort()).toEqual(['AMN-BUY-0001', 'AMN-BUY-0002']);
  });

  it('markRedeemed sets status=redeemed and redeemedAt', async () => {
    const ctx = await seedContext();
    const created = await insertRedemption(ctx);
    const at = new Date('2026-07-05T09:30:00Z');
    await redemptionsRepo.markRedeemed(testDb, created.id, at);
    const found = await redemptionsRepo.findById(testDb, created.id);
    expect(found?.status).toBe('redeemed');
    expect(found?.redeemedAt?.toISOString()).toBe(at.toISOString());
  });

  it('markStatus transitions the status', async () => {
    const ctx = await seedContext();
    const created = await insertRedemption(ctx);
    await redemptionsRepo.markStatus(testDb, created.id, 'refunded');
    const found = await redemptionsRepo.findById(testDb, created.id);
    expect(found?.status).toBe('refunded');
  });

  it('findExpiredReserved returns only reserved rows past expiry', async () => {
    const ctx = await seedContext();
    const past = new Date('2026-07-01T00:00:00Z');
    const future = new Date('2026-07-20T00:00:00Z');
    const now = new Date('2026-07-05T00:00:00Z');

    const expiredReserved = await insertRedemption(ctx, {
      code: 'AMN-EXP-0001',
      expiresAt: past,
    });
    // Reserved but not yet expired — excluded.
    await insertRedemption(ctx, { code: 'AMN-EXP-0002', expiresAt: future });
    // Past expiry but already redeemed — excluded.
    const redeemedPast = await insertRedemption(ctx, { code: 'AMN-EXP-0003', expiresAt: past });
    await redemptionsRepo.markStatus(testDb, redeemedPast.id, 'redeemed');

    const rows = await redemptionsRepo.findExpiredReserved(testDb, now);
    expect(rows.map((r) => r.id)).toEqual([expiredReserved.id]);
  });
});
