import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Kobo } from '../../lib/kobo';
import { fetchActiveRuleSet } from '../rules/rule-set.fetcher';
import { postingsRepo } from '../wallet/postings.repo';

type DbOrTx = PostgresJsDatabase;
const DAY_SECONDS = 24 * 60 * 60;
const MONTH_SECONDS = 30 * 24 * 60 * 60;

/**
 * True if reserving `amount` now would breach any active daily/30-day limit
 * rule on the sub-wallet, counting spends already sent in the window. Used at
 * send time, under a per-sub-wallet lock, as the authoritative limit gate that
 * closes the concurrent evaluate→send race (the evaluate-time check is only an
 * early signal — concurrent evaluations can both pass it before either sends).
 */
export async function wouldExceedSpendLimit(
  db: DbOrTx,
  subWalletId: string,
  amount: Kobo,
  now: Date,
): Promise<boolean> {
  const ruleSet = await fetchActiveRuleSet(db, subWalletId);
  if (!ruleSet) return false;
  for (const rule of ruleSet.rules) {
    if (rule.kind !== 'limit') continue;
    const windowSeconds = rule.config.windowKind === 'daily' ? DAY_SECONDS : MONTH_SECONDS;
    const spent = await postingsRepo.sumDebitsInWindow(db, subWalletId, windowSeconds, now);
    if (spent + amount > rule.config.maxKobo) return true;
  }
  return false;
}
