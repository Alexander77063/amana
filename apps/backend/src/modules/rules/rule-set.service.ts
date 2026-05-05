import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ruleSetsRepo } from './rule-sets.repo';
import { rulesRepo } from './rules.repo';
import type { Rule } from './types';

type DbOrTx = PostgresJsDatabase;

export type PublishInput = {
  subWalletId: string;
  createdByUserId: string;
  rules: Array<Omit<Rule, 'id'>>;
};

export const ruleSetService = {
  async getActiveWithRules(
    db: DbOrTx,
    subWalletId: string,
  ): Promise<{
    ruleSetId: string;
    version: number;
    rules: Array<{ id: string; kind: string; priority: number; configJson: unknown }>;
  } | null> {
    const active = await ruleSetsRepo.findActive(db, subWalletId);
    if (!active) return null;
    const rs = await rulesRepo.listByRuleSet(db, active.id);
    return {
      ruleSetId: active.id,
      version: active.version,
      rules: rs.map((r) => ({
        id: r.id,
        kind: r.kind,
        priority: r.priority,
        configJson: r.configJson,
      })),
    };
  },

  async publishNewVersion(db: DbOrTx, input: PublishInput) {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const current = await ruleSetsRepo.findActive(txDb, input.subWalletId);
      if (current) {
        await ruleSetsRepo.markSuperseded(txDb, current.id);
      }
      const nextVersion = (await ruleSetsRepo.maxVersion(txDb, input.subWalletId)) + 1;
      const ruleSet = await ruleSetsRepo.insert(txDb, {
        subWalletId: input.subWalletId,
        version: nextVersion,
        createdByUserId: input.createdByUserId,
      });
      const rules = await rulesRepo.insertMany(txDb, ruleSet.id, input.rules);
      return { ruleSet, rules };
    });
  },
};
