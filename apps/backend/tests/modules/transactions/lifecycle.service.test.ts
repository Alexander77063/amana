import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { isOk } from '../../../src/lib/result';
import { anomalyService } from '../../../src/modules/anomaly/anomaly.service';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { lifecycleService } from '../../../src/modules/transactions/lifecycle.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

vi.mock('expo-server-sdk', () => {
  const ExpoMock = vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  }));
  (ExpoMock as unknown as Record<string, unknown>).isExpoPushToken = () => true;
  return { Expo: ExpoMock };
});

/**
 * @param fundSubLedger When true (default), credits the sub-wallet's ledger account
 *   with 100K kobo. NOTE: this is a *fixture-only* shape — in production, top-ups credit
 *   the MASTER ledger account, and a sub-wallet's ledger account is never funded (sub-wallets
 *   are spending envelopes, not balance-holding accounts). Pass `false` to model the real
 *   production shape (an unfunded sub LA); see the "limits-only" regression test below.
 */
async function seedFundedSubWallet(fundSubLedger = true) {
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
    anchorAccountId: 'anchor-acct-test',
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
  // Top up sub-wallet with 100K kobo via balanced posting (fixture-only — see fn doc).
  if (fundSubLedger) {
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
  }
  return {
    principalId: principal.id,
    agentId: agent.id,
    subWalletId: sw.sub.id,
    masterId: mw.master.id,
    householdId: hh.id,
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

  it('limits-only: first within-limit spend on an UNFUNDED sub-wallet is allowed, not bumped', async () => {
    // Regression for the M4 funds-model bug (PR #12). Sub-wallets are spending envelopes;
    // production top-ups credit the MASTER, never the sub ledger account. The former inert
    // `amountKobo > subWalletAvailableKobo` check in evaluateLimit therefore fired on the
    // FIRST within-limit spend of every limit-ruled sub-wallet, routing it to require_bump →
    // bump_pending (a SPURIOUS bump, defeating the limits feature — NOT a hard block). The
    // pre-existing happy-path test masked this by funding the sub LA, a shape production never
    // produces; here we seed the real (unfunded) shape so the assertion exercises the bug.
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet(false);
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
    expect(result.transaction.status).toBe('in_flight');
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

    // The agent's wait screen counts down to this. It used to be absent from the evaluate
    // result while the api-client type declared it, so the countdown rendered "NaN:NaN".
    expect(evalResult.bumpExpiresAt).toBeInstanceOf(Date);
    expect(evalResult.bumpExpiresAt.getTime()).toBeGreaterThan(
      new Date('2026-05-03T12:00:00Z').getTime(),
    );

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
      token: token as string,
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

describe('lifecycleService — anomaly_alert', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('dispatches anomaly_alert when score >= 0.85', async () => {
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet();
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
    // Force a high anomaly score for this test.
    vi.spyOn(anomalyService, 'score').mockReturnValueOnce({ score: 0.9, features: [] });
    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    const row = await vi.waitFor(
      async () => {
        const r = await notificationsRepo.findByDedupeKey(
          testDb,
          principalId,
          'in_app',
          `anomaly:${txn.id}`,
        );
        if (!r) throw new Error('in_app anomaly_alert notification not yet inserted');
        return r;
      },
      { timeout: 5000 },
    );
    expect(row.status).toBe('sent');
  });
});

describe('lifecycle — vendor category shadow mode', () => {
  const NOW = new Date('2026-08-25T10:00:00Z');

  beforeEach(async () => {
    await truncateAll();
  });

  /** A claimed vendor categorised `transport`, on an account the tests then spend to. */
  async function claimedTransportVendor(bankCode: string, accountNumber: string): Promise<string> {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode,
      accountNumber,
      displayName: 'DANFO PARK',
      promotedHouseholdCount: 9,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await testDb.execute(
      sql`UPDATE vendors SET category = 'transport', category_source = 'claimed' WHERE id = ${v.id}`,
    );
    return v.id;
  }

  it('does NOT change the decision while enforcement is off, even when the registry disagrees', async () => {
    const { agentId, subWalletId, masterId, principalId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'allowlist', categories: ['food'] } },
      ],
    });
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);

    // The agent claims "food"; the registry says "transport". A food-only allowlist would deny
    // under enforcement — but enforcement is off, so this must still be allowed.
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'food',
    });

    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });
    expect(result.kind).toBe('allow');
  });

  it('records the registry answer on the transaction regardless of enforcement', async () => {
    const { agentId, subWalletId, masterId, principalId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'allowlist', categories: ['food'] } },
      ],
    });
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const vendorId = await claimedTransportVendor(bankCode, accountNumber);
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'food',
    });

    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });

    const rows = await testDb.execute<{ vendor_id: string; resolved_category: string }>(
      sql`SELECT vendor_id, resolved_category FROM transactions WHERE id = ${txn.id}`,
    );
    expect(rows[0]?.vendor_id).toBe(vendorId);
    expect(rows[0]?.resolved_category).toBe('transport');
  });

  it('audits the counterfactual when the shadow decision differs', async () => {
    const { agentId, subWalletId, masterId, principalId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'allowlist', categories: ['food'] } },
      ],
    });
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'food',
    });

    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });

    const entries = await auditRepo.listByAction(testDb, 'vendor.category_shadow');
    expect(entries).toHaveLength(1);
    const payload = entries[0]?.payloadJson as Record<string, unknown>;
    expect(payload.appCategory).toBe('food');
    expect(payload.registryCategory).toBe('transport');
    expect(payload.enforced).toBe(false);
    expect(payload.liveDecision).toBe('allow');
    expect(payload.shadowDecision).toBe('require_bump');
  });

  it('writes no shadow audit row when the registry agrees with the app', async () => {
    const { agentId, subWalletId, masterId, principalId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        {
          kind: 'category',
          priority: 10,
          config: { mode: 'allowlist', categories: ['transport'] },
        },
      ],
    });
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'transport',
    });

    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });
    expect(await auditRepo.listByAction(testDb, 'vendor.category_shadow')).toEqual([]);
  });

  it('ENFORCES the registry category when the household opts in', async () => {
    const { agentId, subWalletId, masterId, principalId, householdId } =
      await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'allowlist', categories: ['food'] } },
      ],
    });
    await testDb.execute(
      sql`UPDATE households SET vendor_category_enforced = TRUE WHERE id = ${householdId}`,
    );
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'food',
    });

    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });
    expect(result.kind).toBe('bump_pending');
  });

  it('never enforces an OBSERVED category, even for an opted-in household', async () => {
    const { agentId, subWalletId, masterId, principalId, householdId } =
      await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'allowlist', categories: ['food'] } },
      ],
    });
    await testDb.execute(
      sql`UPDATE households SET vendor_category_enforced = TRUE WHERE id = ${householdId}`,
    );
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode,
      accountNumber,
      displayName: 'DANFO PARK',
      promotedHouseholdCount: 9,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.setObservedCategory(testDb, v.id, 'transport', 9); // observed, not claimed

    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'food',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });
    expect(result.kind).toBe('allow');
  });

  it('does NOT enforce a SUSPENDED claimed vendor, even for an opted-in household', async () => {
    // The abuse this guards against: a fraudster claims their own account, self-asserts a
    // permissive category to evade a household's category lock, ops notices and suspends the
    // vendor — and enforcement must be revoked from that instant, not merely recorded as noticed.
    const { agentId, subWalletId, masterId, principalId, householdId } =
      await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'allowlist', categories: ['food'] } },
      ],
    });
    await testDb.execute(
      sql`UPDATE households SET vendor_category_enforced = TRUE WHERE id = ${householdId}`,
    );
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const vendorId = await claimedTransportVendor(bankCode, accountNumber);
    // Ops suspends the vendor. Its `category_source` is still `claimed` — suspension, not the
    // category source, is what must strip enforcement here.
    await testDb.execute(sql`UPDATE vendors SET status = 'suspended' WHERE id = ${vendorId}`);

    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'food',
    });

    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });
    // The app-supplied category ('food', allowed) drives the decision, not the registry's
    // ('transport', which would deny under this allowlist). Before the fix, this asserted
    // 'bump_pending' — enforcement kept running against a vendor ops had already suspended.
    expect(result.kind).toBe('allow');

    // Suspension strips authority, not the signal: the registry disagreed with the app, and that
    // divergence must still be visible to an operator watching a suspended vendor's traffic.
    const entries = await auditRepo.listByAction(testDb, 'vendor.category_shadow');
    expect(entries).toHaveLength(1);
    const payload = entries[0]?.payloadJson as Record<string, unknown>;
    expect(payload.enforced).toBe(false);
    expect(payload.registryCategory).toBe('transport');
    expect(payload.appCategory).toBe('food');
  });

  it('writes no shadow row when the sub-wallet has no active rule set', async () => {
    // No category rule published — fetchActiveRuleSet returns null, evaluate is never called,
    // and the decision is a degenerate allow. There is nothing a category could have changed.
    const { agentId, subWalletId, masterId } = await seedFundedSubWallet();
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: bankCode,
      vendorAccount: accountNumber,
      vendorResolvedName: 'M',
      category: 'food',
    });

    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });
    expect(result.kind).toBe('allow');
    expect(await auditRepo.listByAction(testDb, 'vendor.category_shadow')).toEqual([]);
  });

  it('allows a spend to an unregistered vendor exactly as before', async () => {
    const { agentId, subWalletId, masterId, principalId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'allowlist', categories: ['food'] } },
      ],
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: factories.bankCode(),
      vendorAccount: factories.bankAccount(),
      vendorResolvedName: 'M',
      category: 'food',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id,
      initiatingUserId: agentId,
      now: NOW,
    });
    expect(result.kind).toBe('allow');
    expect(await auditRepo.listByAction(testDb, 'vendor.category_shadow')).toEqual([]);
  });
});
