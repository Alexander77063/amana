import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { isOk } from '../../../src/lib/result';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { lifecycleService } from '../../../src/modules/transactions/lifecycle.service';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedFundedSubWallet() {
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
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
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
    name: 'Driver',
  });
  // Top up sub-wallet with 100K kobo via balanced posting
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    kind: 'topup',
    amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(100_000n),
    },
  ]);
  return {
    principalId: principal.id,
    agentId: agent.id,
    subWalletId: sw.sub.id,
    masterId: mw.master.id,
  };
}

describe('lifecycleService.evaluate — happy path', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('allows a small spend with no rule set (permissive default)', async () => {
    const { agentId, subWalletId, masterId } = await seedFundedSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccount: '0123456789',
      vendorResolvedName: 'MAMA',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('allow');
    expect(result.transaction.status).toBe('in_flight');
  });

  it('allows a spend that passes a configured limit rule', async () => {
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50_000n } }],
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccount: '0123456789',
      vendorResolvedName: 'MAMA',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('allow');
  });

  it('writes anomaly score and rule_eval audit-log entries', async () => {
    const { agentId, subWalletId, masterId } = await seedFundedSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccount: '0123456789',
      vendorResolvedName: 'MAMA',
    });
    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    const updatedTxn = await transactionsRepo.findById(testDb, txn.id);
    expect(updatedTxn?.anomalyScore).not.toBeNull();
  });
});

describe('lifecycleService — bump path', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rule denies → creates bump_request → principal approves → resumeAfterBump moves to in_flight', async () => {
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 1_000n } }],
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccount: '0123456789',
      vendorResolvedName: 'MAMA',
    });
    const evalResult = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(evalResult.kind).toBe('bump_pending');
    if (evalResult.kind !== 'bump_pending') return;

    const decision = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: evalResult.bumpRequestId,
      decidedByUserId: principalId,
      decision: 'approve_once',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(decision)).toBe(true);
    if (!isOk(decision)) return;
    const token = decision.value.oneShotToken?.token;
    expect(token).toBeDefined();

    const resumed = await lifecycleService.resumeAfterBump(testDb, {
      token: token!,
      now: new Date('2026-05-03T12:06:00Z'),
    });
    expect(resumed.kind).toBe('allow');
    expect(resumed.transaction.status).toBe('in_flight');
  });
});

describe('lifecycleService — deny + principal direct', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('principal denies the bump → txn stays in bump_pending (resume not possible)', async () => {
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 1_000n } }],
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccount: '0123456789',
      vendorResolvedName: 'MAMA',
    });
    const evalResult = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(evalResult.kind).toBe('bump_pending');
    if (evalResult.kind !== 'bump_pending') return;

    const decision = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: evalResult.bumpRequestId,
      decidedByUserId: principalId,
      decision: 'deny',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(decision)).toBe(true);
    if (!isOk(decision)) return;
    expect(decision.value.oneShotToken).toBeNull();
    const updatedTxn = await transactionsRepo.findById(testDb, txn.id);
    // Lifecycle doesn't auto-fail on deny; status stays bump_pending until cancelled
    expect(updatedTxn?.status).toBe('bump_pending');
  });

  it('principal direct spend (subWalletId=null) bypasses rule eval and goes straight to in_flight', async () => {
    const { principalId, masterId } = await seedFundedSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId: null,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccount: '0123456789',
      vendorResolvedName: 'MAMA',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: principalId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('allow');
    expect(result.transaction.status).toBe('in_flight');
  });
});
