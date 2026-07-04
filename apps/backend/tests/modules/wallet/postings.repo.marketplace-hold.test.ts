import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { expiryService } from '../../../src/modules/marketplace/expiry.service';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const DAY = 24 * 60 * 60;

describe('postingsRepo.sumDebitsInWindow — marketplace holds', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seed() {
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
    return { agent, mw, sw };
  }

  function purchaseInput(over: Record<string, unknown>) {
    return {
      retailerId: 'retailer-1',
      catalogItemId: 'item-1',
      retailerBankCode: '058',
      retailerAccount: '0123456789',
      grossKobo: kobo(20_000n),
      discountedKobo: kobo(12_345n),
      idempotencyKey: factories.idempotencyKey(),
      ...over,
    };
  }

  it('counts an active marketplace hold toward the window, then drops it once expired-refunded', async () => {
    const { agent, mw, sw } = await seed();
    const now = new Date();

    // Baseline: nothing yet.
    expect(await postingsRepo.sumDebitsInWindow(testDb, sw.sub.id, DAY, now)).toBe(kobo(0n));

    // Reserve a marketplace hold (kind='marketplace_purchase', no sent_at, status draft).
    await purchaseService.create(
      testDb,
      purchaseInput({
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        now,
      }),
    );

    // The active hold's discounted debit now counts in the window.
    expect(await postingsRepo.sumDebitsInWindow(testDb, sw.sub.id, DAY, now)).toBe(kobo(12_345n));

    // Isolate the status filter (the new EXISTS clause) from the time filter: use a reference
    // time past the 168h TTL but a window WIDE enough that the hold's created_at stays in-window
    // throughout — so the ONLY variable that changes the sum is the redemption status.
    const afterExpiry = new Date(now.getTime() + 200 * 3600 * 1000);
    const WIDE = 31 * DAY; // afterExpiry - 31d < created_at ⇒ time keeps the hold in-window

    // Still reserved (active) → counts, even at afterExpiry, purely because of the wide window.
    expect(await postingsRepo.sumDebitsInWindow(testDb, sw.sub.id, WIDE, afterExpiry)).toBe(
      kobo(12_345n),
    );

    // Expire + refund the hold — the reversal credits the sub LA back and flips the redemption to
    // `expired`, so the EXISTS('reserved','redeemed') clause fails and the hold STOPS counting.
    const swept = await expiryService.sweepExpired(testDb, afterExpiry);
    expect(swept).toBe(1);

    // Same wide window, same reference time: only the status changed → drops to 0.
    expect(await postingsRepo.sumDebitsInWindow(testDb, sw.sub.id, WIDE, afterExpiry)).toBe(
      kobo(0n),
    );
  });

  it('a plain settled spend still counts (existing behaviour preserved)', async () => {
    const { mw, sw } = await seed();
    const now = new Date();

    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      kind: 'spend',
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await transactionsRepo.setStatus(testDb, txn.id, 'settled', now);
    await testDb.execute(
      sql`UPDATE transactions SET sent_at = ${now.toISOString()}::timestamptz WHERE id = ${txn.id}`,
    );
    await postingsRepo.insertMany(testDb, [
      {
        transactionId: txn.id,
        ledgerAccountId: sw.ledgerAccountId,
        debitKobo: kobo(5_000n),
        creditKobo: kobo(0n),
      },
    ]);

    expect(await postingsRepo.sumDebitsInWindow(testDb, sw.sub.id, DAY, now)).toBe(kobo(5_000n));
  });
});
