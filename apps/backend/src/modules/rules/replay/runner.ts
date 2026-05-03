import { readFile } from 'node:fs/promises';
import { evaluate } from '../engine';
import type { CaseRecord } from './capture';
import type { Decision } from '../types';
import { kobo } from '../../../lib/kobo';

export interface ReplayResult {
  matched: number;
  mismatched: { caseIdx: number; expected: Decision; actual: Decision }[];
}

const BIGINT_KEYS = new Set([
  'amountKobo',
  'maxKobo',
  'wouldBeKobo',
  'subWalletAvailableKobo',
  'spentLast24hKobo',
  'spentLast30dKobo',
]);

function reviver(key: string, value: unknown): unknown {
  if (BIGINT_KEYS.has(key) && typeof value === 'string') return BigInt(value);
  if (key === 'confirmedAt' && typeof value === 'string') return new Date(value);
  return value;
}

function castRecord(raw: unknown): CaseRecord {
  const r = raw as CaseRecord;
  r.intent.amountKobo = kobo(r.intent.amountKobo as unknown as bigint);
  r.ctx.ledger.subWalletAvailableKobo = kobo(r.ctx.ledger.subWalletAvailableKobo as unknown as bigint);
  r.ctx.ledger.spentLast24hKobo = kobo(r.ctx.ledger.spentLast24hKobo as unknown as bigint);
  r.ctx.ledger.spentLast30dKobo = kobo(r.ctx.ledger.spentLast30dKobo as unknown as bigint);
  return r;
}

function bigintToString(_: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

function decisionsEqual(a: Decision, b: Decision): boolean {
  return JSON.stringify(a, bigintToString) === JSON.stringify(b, bigintToString);
}

export async function runReplay(filePath: string): Promise<ReplayResult> {
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let matched = 0;
  const mismatched: ReplayResult['mismatched'] = [];
  lines.forEach((line, i) => {
    const parsed = JSON.parse(line, reviver);
    const record = castRecord(parsed);
    const actual = evaluate(record.intent, record.ruleSet, record.ctx);
    if (decisionsEqual(actual, record.decision)) {
      matched += 1;
    } else {
      mismatched.push({ caseIdx: i, expected: record.decision, actual });
    }
  });
  return { matched, mismatched };
}
