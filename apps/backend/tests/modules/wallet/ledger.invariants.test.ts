import { beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';

type Op =
  | { kind: 'topup'; amount: bigint }
  | { kind: 'spend'; subIdx: number; amount: bigint }
  | { kind: 'fee'; amount: bigint };

async function setup() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const provisioned = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const subs = [];
  for (let i = 0; i < 3; i++) {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const sub = await subWalletsRepo.provision(testDb, {
      masterWalletId: provisioned.master.id, agentUserId: agent.id, name: `Agent${i}`,
    });
    subs.push({ subId: sub.sub.id, ledgerAccountId: sub.ledgerAccountId });
  }
  return { masterId: provisioned.master.id, ledgerAccountIds: provisioned.ledgerAccountIds, subs };
}

async function applyOp(state: Awaited<ReturnType<typeof setup>>, op: Op): Promise<void> {
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: state.masterId,
    kind: op.kind === 'topup' ? 'topup' : op.kind === 'fee' ? 'fee' : 'spend',
    amountKobo: kobo(op.kind === 'topup' || op.kind === 'fee' ? op.amount : op.amount),
    idempotencyKey: factories.idempotencyKey(),
    subWalletId: op.kind === 'spend' ? state.subs[op.subIdx]?.subId : null,
  });
  if (op.kind === 'topup') {
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: state.ledgerAccountIds.master, debitKobo: kobo(op.amount), creditKobo: kobo(0n) },
      { ledgerAccountId: state.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(op.amount) },
    ]);
  } else if (op.kind === 'fee') {
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: state.ledgerAccountIds.master, debitKobo: kobo(0n), creditKobo: kobo(op.amount) },
      { ledgerAccountId: state.ledgerAccountIds.fee, debitKobo: kobo(op.amount), creditKobo: kobo(0n) },
    ]);
  } else {
    const subLA = state.subs[op.subIdx]?.ledgerAccountId;
    if (!subLA) return;
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: subLA, debitKobo: kobo(op.amount), creditKobo: kobo(0n) },
      { ledgerAccountId: state.ledgerAccountIds.master, debitKobo: kobo(0n), creditKobo: kobo(op.amount) },
    ]);
  }
}

const opArb = fc.oneof(
  fc.record({ kind: fc.constant('topup' as const), amount: fc.bigInt({ min: 1n, max: 100000n }) }),
  fc.record({ kind: fc.constant('fee' as const), amount: fc.bigInt({ min: 1n, max: 1000n }) }),
  fc.record({
    kind: fc.constant('spend' as const),
    subIdx: fc.integer({ min: 0, max: 2 }),
    amount: fc.bigInt({ min: 1n, max: 5000n }),
  }),
);

describe('ledger invariants (property-based)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('Σ debits == Σ credits across all postings, for any operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 20 }), async (ops) => {
        await truncateAll();
        const state = await setup();
        for (const op of ops) await applyOp(state, op);
        const sums = await testDb.execute<{ d: string; c: string }>(sql`
          SELECT COALESCE(SUM(debit_kobo), 0)::text AS d, COALESCE(SUM(credit_kobo), 0)::text AS c
          FROM postings
        `);
        expect(BigInt(sums[0]?.d ?? '0')).toBe(BigInt(sums[0]?.c ?? '0'));
      }),
      { numRuns: 25 },
    );
  }, 120_000);

  it('idempotency key replay produces zero new postings', async () => {
    const state = await setup();
    const key = factories.idempotencyKey();
    await transactionsRepo.insert(testDb, {
      masterWalletId: state.masterId, kind: 'topup', amountKobo: kobo(1000n), idempotencyKey: key,
    });
    const before = await testDb.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM transactions`);
    await expect(
      transactionsRepo.insert(testDb, {
        masterWalletId: state.masterId, kind: 'topup', amountKobo: kobo(1000n), idempotencyKey: key,
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
    const after = await testDb.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM transactions`);
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});
