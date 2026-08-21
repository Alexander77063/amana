import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { ForbiddenError } from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { expiryService } from '../../../src/modules/marketplace/expiry.service';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { redeemService } from '../../../src/modules/marketplace/redeem.service';
import { redemptionsRepo } from '../../../src/modules/marketplace/redemptions.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { ensureRetailerAndItem } from '../../helpers/marketplace-seed';
import { testDb, truncateAll } from '../../helpers/test-db';

// Assigned per-test by the seed helpers below — redemptions.retailer_id is a real uuid FK (SP4).
let RETAILER_ID: string;
let ITEM_ID: string;
const RETAILER_BANK = '058';
const RETAILER_ACCT = '0123456789';
const GROSS = 20_000n;
const DISCOUNTED = 12_345n;
const PURCHASE_AT = new Date('2026-07-01T00:00:00Z');
// expiresAt = PURCHASE_AT + 168h = 2026-07-08; anything past that is expired.
const AFTER_EXPIRY = new Date('2026-07-20T00:00:00Z');
const BEFORE_EXPIRY = new Date('2026-07-02T00:00:00Z');

/** Seed a household + master wallet + agent sub-wallet and reserve one voucher (status='reserved'). */
async function seedReservedSub() {
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
  const seeded = await ensureRetailerAndItem(testDb);
  RETAILER_ID = seeded.retailer.id;
  ITEM_ID = seeded.item.id;
  const { redemption } = await purchaseService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    retailerId: RETAILER_ID,
    catalogItemId: ITEM_ID,
    retailerBankCode: RETAILER_BANK,
    retailerAccount: RETAILER_ACCT,
    grossKobo: kobo(GROSS),
    discountedKobo: kobo(DISCOUNTED),
    idempotencyKey: factories.idempotencyKey(),
    now: PURCHASE_AT,
  });
  return { principal, hh, mw, agent, sw, redemption };
}

/** Seed a principal-direct (subWalletId=null) reserved voucher spending the master LA. */
async function seedReservedPrincipalDirect() {
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
    anchorVirtualAccount: '2234567890',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-pd',
  });
  const seeded = await ensureRetailerAndItem(testDb);
  RETAILER_ID = seeded.retailer.id;
  ITEM_ID = seeded.item.id;
  const { redemption } = await purchaseService.create(testDb, {
    actorUserId: principal.id,
    masterWalletId: mw.master.id,
    subWalletId: null,
    retailerId: RETAILER_ID,
    catalogItemId: ITEM_ID,
    retailerBankCode: RETAILER_BANK,
    retailerAccount: RETAILER_ACCT,
    grossKobo: kobo(GROSS),
    discountedKobo: kobo(DISCOUNTED),
    idempotencyKey: factories.idempotencyKey(),
    now: PURCHASE_AT,
  });
  return { principal, hh, mw, redemption };
}

function okAdapter(json: Record<string, unknown>, status = 202) {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  return { adapter };
}

describe('expiryService.sweepExpired', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('(a) refunds an expired reserved voucher: suspense debited, source credited, status expired', async () => {
    const { mw, sw, redemption } = await seedReservedSub();

    // Post-reserve: source LA holds the discounted debit, suspense the matching credit.
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(DISCOUNTED);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(
      -DISCOUNTED,
    );

    const count = await expiryService.sweepExpired(testDb, AFTER_EXPIRY);
    expect(count).toBe(1);

    // Source balance restored to pre-purchase (0); suspense drained back to 0.
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(0n);

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('expired');

    // The refund is a separate `reversal` txn keyed redeem-expire:<id>, settled.
    const refund = await transactionsRepo.findByIdempotencyKey(
      testDb,
      `redeem-expire:${redemption.id}`,
    );
    expect(refund?.kind).toBe('reversal');
    expect(refund?.amountKobo).toBe(DISCOUNTED);
    expect(refund?.status).toBe('settled');
  });

  it('(b) leaves a not-yet-expired reserved voucher untouched', async () => {
    const { mw, sw, redemption } = await seedReservedSub();

    const count = await expiryService.sweepExpired(testDb, BEFORE_EXPIRY);
    expect(count).toBe(0);

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('reserved');
    // Hold intact.
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(DISCOUNTED);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(
      -DISCOUNTED,
    );
  });

  it('(c) leaves a redeemed voucher untouched even past its expiry', async () => {
    const { hh, mw, sw, redemption } = await seedReservedSub();
    const { adapter } = okAdapter({
      id: 'tr-1',
      status: 'PENDING',
      reference: `redeem:${redemption.id}`,
    });
    await redeemService.redeem(testDb, adapter, {
      retailerId: RETAILER_ID,
      code: redemption.code,
      now: BEFORE_EXPIRY,
      householdRef: hh.id,
    });

    const suspenseBefore = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceBefore = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);

    const count = await expiryService.sweepExpired(testDb, AFTER_EXPIRY);
    expect(count).toBe(0);

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('redeemed');
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(
      suspenseBefore,
    );
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(sourceBefore);
    // No refund txn was created.
    const refund = await transactionsRepo.findByIdempotencyKey(
      testDb,
      `redeem-expire:${redemption.id}`,
    );
    expect(refund).toBeUndefined();
  });

  it('(d) is idempotent: a second sweep does nothing', async () => {
    const { mw, sw, redemption } = await seedReservedSub();

    expect(await expiryService.sweepExpired(testDb, AFTER_EXPIRY)).toBe(1);
    // Second sweep finds nothing reserved.
    expect(await expiryService.sweepExpired(testDb, AFTER_EXPIRY)).toBe(0);

    // Balances unchanged by the second run; still restored to 0.
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(0n);
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('expired');
  });

  it('(f) principal-direct voucher refunds to the master LA', async () => {
    const { mw, redemption } = await seedReservedPrincipalDirect();
    const masterLA = mw.ledgerAccountIds.master;

    // Post-reserve: master LA debited discounted.
    expect(await postingsRepo.accountBalance(testDb, masterLA)).toBe(DISCOUNTED);

    const count = await expiryService.sweepExpired(testDb, AFTER_EXPIRY);
    expect(count).toBe(1);

    // Refunded to master LA → back to 0; suspense drained.
    expect(await postingsRepo.accountBalance(testDb, masterLA)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(0n);
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('expired');
  });
});

describe('expiryService.cancel', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('(e) refunds a reserved voucher for its buyer and marks it refunded', async () => {
    const { agent, mw, sw, redemption } = await seedReservedSub();

    await expiryService.cancel(testDb, {
      redemptionId: redemption.id,
      actorUserId: agent.id,
      now: BEFORE_EXPIRY,
    });

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('refunded');
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(0n);

    const refund = await transactionsRepo.findByIdempotencyKey(
      testDb,
      `redeem-cancel:${redemption.id}`,
    );
    expect(refund?.kind).toBe('reversal');
    expect(refund?.amountKobo).toBe(DISCOUNTED);
    expect(refund?.status).toBe('settled');
  });

  it('(e-authz) a stranger cannot cancel: ForbiddenError, no refund, voucher stays reserved', async () => {
    const { mw, sw, redemption } = await seedReservedSub();
    const stranger = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });

    await expect(
      expiryService.cancel(testDb, {
        redemptionId: redemption.id,
        actorUserId: stranger.id,
        now: BEFORE_EXPIRY,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('reserved');
    // Hold intact — no refund posted.
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(DISCOUNTED);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(
      -DISCOUNTED,
    );
    expect(
      await transactionsRepo.findByIdempotencyKey(testDb, `redeem-cancel:${redemption.id}`),
    ).toBeUndefined();
  });

  it('(e-conflict) cancelling an already-redeemed voucher throws ConflictError', async () => {
    const { hh, agent, redemption } = await seedReservedSub();
    const { adapter } = okAdapter({
      id: 'tr-2',
      status: 'PENDING',
      reference: `redeem:${redemption.id}`,
    });
    await redeemService.redeem(testDb, adapter, {
      retailerId: RETAILER_ID,
      code: redemption.code,
      now: BEFORE_EXPIRY,
      householdRef: hh.id,
    });

    await expect(
      expiryService.cancel(testDb, {
        redemptionId: redemption.id,
        actorUserId: agent.id,
        now: BEFORE_EXPIRY,
      }),
    ).rejects.toThrow();

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('redeemed');
  });
});
