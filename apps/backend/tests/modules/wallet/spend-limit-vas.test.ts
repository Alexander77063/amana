import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { wouldExceedSpendLimit } from '../../../src/modules/transactions/spend-limit';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('spend-limit counts vas_purchase holds', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedWithLimit(maxKobo: bigint) {
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
    // Daily spend limit rule = maxKobo.
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo } }],
    });
    return { principal, agent, mw, sw };
  }

  /** A VAS reserve: debit the sub LA, credit suspense, txn kind=vas_purchase, status in_flight. */
  async function insertVasReserve(
    mw: Awaited<ReturnType<typeof masterWalletsRepo.provision>>,
    sw: Awaited<ReturnType<typeof subWalletsRepo.provision>>,
    amountKobo: bigint,
  ) {
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'vas_purchase',
      amountKobo: kobo(amountKobo),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(amountKobo), creditKobo: kobo(0n) },
      {
        ledgerAccountId: mw.ledgerAccountIds.suspense,
        debitKobo: kobo(0n),
        creditKobo: kobo(amountKobo),
      },
    ]);
    await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
    return txn;
  }

  async function setTxnStatus(id: string, status: 'settled' | 'failed') {
    await transactionsRepo.setStatus(testDb, id, status);
  }

  it('an in_flight VAS hold consumes the window; a failed one does not', async () => {
    const { mw, sw } = await seedWithLimit(10_000n); // daily limit rule = ₦10,000
    const now = new Date();

    const txn = await insertVasReserve(mw, sw, 4_000n); // vas_purchase, in_flight

    // 4,000 already held. 7,000 more → 11,000 > 10,000 → exceeds. 6,000 more → 10,000, not > → ok.
    expect(await wouldExceedSpendLimit(testDb, sw.sub.id, kobo(7_000n), now)).toBe(true);
    expect(await wouldExceedSpendLimit(testDb, sw.sub.id, kobo(6_000n), now)).toBe(false);

    // A failed (refunded) VAS purchase drops out of the window.
    await setTxnStatus(txn.id, 'failed');
    expect(await wouldExceedSpendLimit(testDb, sw.sub.id, kobo(7_000n), now)).toBe(false);
  });
});
