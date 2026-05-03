import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { rules } from '../../db/schema';
import type { Rule } from './types';

type DbOrTx = PostgresJsDatabase;

export type RuleRow = typeof rules.$inferSelect;

export const rulesRepo = {
  async insertMany(
    db: DbOrTx,
    ruleSetId: string,
    input: Array<Omit<Rule, 'id'>>,
  ): Promise<RuleRow[]> {
    if (input.length === 0) return [];
    const values = input.map((r) => ({
      ruleSetId,
      kind: r.kind,
      configJson: JSON.parse(
        JSON.stringify(r.config, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
      ),
      priority: r.priority,
    }));
    return db.insert(rules).values(values).returning();
  },

  async listByRuleSet(db: DbOrTx, ruleSetId: string): Promise<RuleRow[]> {
    return db.select().from(rules).where(eq(rules.ruleSetId, ruleSetId));
  },
};
