import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { balanceService } from '../../../src/modules/wallet/balance.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

/** A principal, a household with a funded master, an agent, and a sub-wallet for them. */
async function scaffold(tag: string) {
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
    anchorVirtualAccount: '0123456789',
    anchorBankCode: '058',
    anchorAccountId: `spend-${tag}`,
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
    name: 'A',
  });
  return { principal, mw, sw };
}

/**
 * Record a settled spend through the sub-wallet.
 *
 * sumDebitsInWindow deliberately counts only spend / marketplace_purchase / vas_purchase, and
 * keys the window on `sent_at` — a top-up debit is money arriving, not spending, and must never
 * count against a limit. So the fixture has to build a real settled spend, exactly as the
 * postings.repo.sumDebits tests do, or it silently measures nothing.
 */
async function spend(
  mw: Awaited<ReturnType<typeof scaffold>>['mw'],
  ledgerAccountId: string,
  amount: bigint,
  at: Date = new Date(),
) {
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    kind: 'spend',
    amountKobo: kobo(amount),
    idempotencyKey: factories.idempotencyKey(),
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'settled', at);
  await testDb.execute(
    sql`UPDATE transactions SET sent_at = ${at.toISOString()}::timestamptz WHERE id = ${txn.id}`,
  );
  await postingsRepo.insertMany(testDb, [
    { transactionId: txn.id, ledgerAccountId, debitKobo: kobo(amount), creditKobo: kobo(0n) },
  ]);
  return txn;
}

describe('balanceService.spendSummaryForSubWallet', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('reports nothing spent and no caps for a fresh sub-wallet', async () => {
    const { sw } = await scaffold('fresh');
    const s = await balanceService.spendSummaryForSubWallet(testDb, sw.sub.id);
    expect(s.spentLast24hKobo).toBe(0n);
    expect(s.spentLast30dKobo).toBe(0n);
    expect(s.dailyLimitKobo).toBeNull();
    expect(s.monthlyLimitKobo).toBeNull();
  });

  it('counts spending in both windows', async () => {
    const { mw, sw } = await scaffold('counts');
    await spend(mw, sw.ledgerAccountId, 482_000n);
    const s = await balanceService.spendSummaryForSubWallet(testDb, sw.sub.id);
    expect(s.spentLast24hKobo).toBe(482_000n);
    expect(s.spentLast30dKobo).toBe(482_000n);
  });

  it('reads the caps off the published rule set, so the screen agrees with the engine', async () => {
    const { principal, sw } = await scaffold('caps');
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [
        { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 2_000_000n } },
        { kind: 'limit', priority: 20, config: { windowKind: 'monthly', maxKobo: 30_000_000n } },
      ],
    });
    const s = await balanceService.spendSummaryForSubWallet(testDb, sw.sub.id);
    expect(s.dailyLimitKobo).toBe(2_000_000n);
    expect(s.monthlyLimitKobo).toBe(30_000_000n);
  });

  // Publishing two caps for the same window is legal; only the tighter one ever binds, so that is
  // the one the owner must be shown. Reporting the looser figure would overstate what is allowed.
  it('reports the tightest cap when several of a window are published', async () => {
    const { principal, sw } = await scaffold('tightest');
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [
        { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 5_000_000n } },
        { kind: 'limit', priority: 20, config: { windowKind: 'daily', maxKobo: 1_000_000n } },
      ],
    });
    const s = await balanceService.spendSummaryForSubWallet(testDb, sw.sub.id);
    expect(s.dailyLimitKobo).toBe(1_000_000n);
  });

  it('ignores non-limit rules when looking for caps', async () => {
    const { principal, sw } = await scaffold('nonlimit');
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [
        {
          kind: 'category',
          priority: 10,
          config: { mode: 'allowlist', categories: ['transport'] },
        },
      ],
    });
    const s = await balanceService.spendSummaryForSubWallet(testDb, sw.sub.id);
    expect(s.dailyLimitKobo).toBeNull();
    expect(s.monthlyLimitKobo).toBeNull();
  });

  // The point of the whole change: the ledger figure is not a balance a principal can act on.
  // This asserts the two are reported separately so a screen can never conflate them again.
  it('reports the ledger figure separately from what was spent', async () => {
    const { mw, sw } = await scaffold('separate');
    await spend(mw, sw.ledgerAccountId, 250_000n);
    const s = await balanceService.spendSummaryForSubWallet(testDb, sw.sub.id);
    expect(s.balanceKobo).toBe(await balanceService.accountBalanceForSubWallet(testDb, sw.sub.id));
    expect(s.spentLast24hKobo).toBe(250_000n);
  });

  it('excludes spending that falls outside the 24-hour window', async () => {
    const { mw, sw } = await scaffold('window');
    await spend(mw, sw.ledgerAccountId, 100_000n);
    // Ask as if two days had passed: the 24h window must have moved past this spend while the
    // 30-day window still contains it.
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const s = await balanceService.spendSummaryForSubWallet(testDb, sw.sub.id, later);
    expect(s.spentLast24hKobo).toBe(0n);
    expect(s.spentLast30dKobo).toBe(100_000n);
  });
});
