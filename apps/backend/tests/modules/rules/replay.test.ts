import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appendCase } from '../../../src/modules/rules/replay/capture';
import { runReplay } from '../../../src/modules/rules/replay/runner';
import { evaluate } from '../../../src/modules/rules/engine';
import { kobo } from '../../../src/lib/kobo';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Repo root is 3 levels up: tests/modules/rules → tests → apps/backend → repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

describe('replay corpus runner', () => {
  it('returns matched count when all decisions match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'amana-replay-'));
    const file = join(dir, 'corpus.ndjson');
    const intent = {
      amountKobo: kobo(5000n),
      category: 'groceries',
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'MAMA',
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    };
    const ruleSet = { id: 'rs', subWalletId: 'sw', version: 1, rules: [] };
    const ctx = {
      ledger: { subWalletAvailableKobo: kobo(100000n), spentLast24hKobo: kobo(0n), spentLast30dKobo: kobo(0n) },
      anomalyScore: 0.1,
    };
    const decision = evaluate(intent, ruleSet, ctx);
    await appendCase(file, { intent, ruleSet, ctx, decision });

    const result = await runReplay(file);
    expect(result.matched).toBe(1);
    expect(result.mismatched).toHaveLength(0);
  });

  it('flags mismatched records when engine output differs from expected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'amana-replay-'));
    const file = join(dir, 'corpus.ndjson');
    await writeFile(file, JSON.stringify({
      intent: { amountKobo: '5000', category: 'g', vendorBankCode: null, vendorAccountNumber: null, vendorResolvedName: null, confirmedAt: '2026-05-03T12:00:00.000Z' },
      ruleSet: { id: 'rs', subWalletId: 'sw', version: 1, rules: [] },
      ctx: { ledger: { subWalletAvailableKobo: '100000', spentLast24hKobo: '0', spentLast30dKobo: '0' }, anomalyScore: 0 },
      decision: { kind: 'require_bump', firstFailedReason: { code: 'INSUFFICIENT_FUNDS' }, allReasons: [{ code: 'INSUFFICIENT_FUNDS' }] },
    }) + '\n');

    const result = await runReplay(file);
    expect(result.matched).toBe(0);
    expect(result.mismatched).toHaveLength(1);
  });

  it('replays the committed seed corpus successfully', async () => {
    const result = await runReplay(join(REPO_ROOT, 'apps/backend/test-corpus/rule-engine/seed.ndjson'));
    expect(result.mismatched).toHaveLength(0);
    expect(result.matched).toBeGreaterThanOrEqual(3);
  });
});
