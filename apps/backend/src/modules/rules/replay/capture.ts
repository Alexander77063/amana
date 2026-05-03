import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Decision, RuleEvaluationContext, RuleSet, TxnIntent } from '../types';

export interface CaseRecord {
  intent: TxnIntent;
  ruleSet: RuleSet;
  ctx: RuleEvaluationContext;
  decision: Decision;
}

const bigintReplacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export async function appendCase(filePath: string, record: CaseRecord): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(record, bigintReplacer);
  await appendFile(filePath, `${line}\n`, 'utf8');
}
