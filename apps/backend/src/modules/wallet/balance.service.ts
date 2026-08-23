import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ledgerAccounts } from '../../db/schema';
import { ruleSetService } from '../rules/rule-set.service';
import { postingsRepo } from './postings.repo';

type DbOrTx = PostgresJsDatabase;

const SPENT_LAST_24H_SECONDS = 24 * 60 * 60;
const SPENT_LAST_30D_SECONDS = 30 * 24 * 60 * 60;

export type SubWalletSpend = {
  /**
   * The sub ledger account's balance. Under the limits-only funds model (decision #7) this is
   * structurally ~0 — top-ups credit the MASTER and spends debit it — so it is kept for the
   * ledger's own reconciliation and is NOT a figure to show a principal as "balance".
   */
  balanceKobo: bigint;
  spentLast24hKobo: bigint;
  spentLast30dKobo: bigint;
  /** The active daily limit, if a limit rule is published. Null means unlimited. */
  dailyLimitKobo: bigint | null;
  monthlyLimitKobo: bigint | null;
};

export const balanceService = {
  async accountBalanceForSubWallet(db: DbOrTx, subWalletId: string): Promise<bigint> {
    const [la] = await db
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.subWalletId, subWalletId), eq(ledgerAccounts.kind, 'sub')))
      .limit(1);
    if (!la) throw new Error(`balance: no sub ledger-account for ${subWalletId}`);
    return postingsRepo.accountBalance(db, la.id);
  },

  /**
   * What a principal actually wants to know about a sub-wallet: how much has been spent through
   * it, against what they capped it at.
   *
   * A sub-wallet is a spending envelope, not an account that holds money, so its ledger balance
   * is always about zero. Reporting that as "balance" tells the owner nothing and actively
   * misleads — an envelope with a ₦20,000 daily cap and ₦0.00 next to it reads as an empty
   * wallet. Spend-against-limit is the same question the limit evaluator answers at authorisation
   * time, and it uses the same windows so the screen cannot disagree with the engine.
   */
  async spendSummaryForSubWallet(
    db: DbOrTx,
    subWalletId: string,
    now: Date = new Date(),
  ): Promise<SubWalletSpend> {
    const balanceKobo = await balanceService.accountBalanceForSubWallet(db, subWalletId);
    const spentLast24hKobo = await postingsRepo.sumDebitsInWindow(
      db,
      subWalletId,
      SPENT_LAST_24H_SECONDS,
      now,
    );
    const spentLast30dKobo = await postingsRepo.sumDebitsInWindow(
      db,
      subWalletId,
      SPENT_LAST_30D_SECONDS,
      now,
    );

    // Read the caps off the published rule set rather than storing them separately, so the
    // number on screen is the number that will be enforced.
    const active = await ruleSetService.getActiveWithRules(db, subWalletId);
    let dailyLimitKobo: bigint | null = null;
    let monthlyLimitKobo: bigint | null = null;
    for (const rule of active?.rules ?? []) {
      if (rule.kind !== 'limit') continue;
      const cfg = (rule.configJson ?? {}) as { windowKind?: string; maxKobo?: string | number };
      if (cfg.maxKobo === undefined || cfg.maxKobo === null) continue;
      let max: bigint;
      try {
        max = BigInt(cfg.maxKobo);
      } catch {
        continue;
      }
      // Several limit rules of the same window can be published; the tightest is the one that
      // actually binds, which is what the owner should see.
      if (cfg.windowKind === 'monthly') {
        monthlyLimitKobo =
          monthlyLimitKobo === null ? max : max < monthlyLimitKobo ? max : monthlyLimitKobo;
      } else {
        dailyLimitKobo =
          dailyLimitKobo === null ? max : max < dailyLimitKobo ? max : dailyLimitKobo;
      }
    }

    return {
      balanceKobo,
      spentLast24hKobo,
      spentLast30dKobo,
      dailyLimitKobo,
      monthlyLimitKobo,
    };
  },
};
