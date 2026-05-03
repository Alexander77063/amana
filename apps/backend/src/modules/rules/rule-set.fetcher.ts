import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ruleSetsRepo } from './rule-sets.repo';
import { type RuleRow, rulesRepo } from './rules.repo';
import type { Rule, RuleSet } from './types';

type DbOrTx = PostgresJsDatabase;

const BIGINT_KEYS = new Set(['maxKobo']);

function coerceBigints(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(coerceBigints);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (BIGINT_KEYS.has(k) && typeof v === 'string') out[k] = BigInt(v);
    else out[k] = coerceBigints(v);
  }
  return out;
}

function rowToRule(row: RuleRow): Rule {
  const config = coerceBigints(row.configJson) as Rule['config'];
  switch (row.kind) {
    case 'limit':
      return { id: row.id, kind: 'limit', priority: row.priority, config: config as never };
    case 'category':
      return { id: row.id, kind: 'category', priority: row.priority, config: config as never };
    case 'time_window':
      return { id: row.id, kind: 'time_window', priority: row.priority, config: config as never };
    case 'allowlist':
      return { id: row.id, kind: 'allowlist', priority: row.priority, config: config as never };
    case 'anomaly_threshold':
      return {
        id: row.id,
        kind: 'anomaly_threshold',
        priority: row.priority,
        config: config as never,
      };
  }
}

export async function fetchActiveRuleSet(
  db: DbOrTx,
  subWalletId: string,
): Promise<RuleSet | undefined> {
  const rs = await ruleSetsRepo.findActive(db, subWalletId);
  if (!rs) return undefined;
  const ruleRows = await rulesRepo.listByRuleSet(db, rs.id);
  return {
    id: rs.id,
    subWalletId: rs.subWalletId,
    version: rs.version,
    rules: ruleRows.map(rowToRule),
  };
}
