import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { isErr, isOk } from '../../../src/lib/result';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';
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

async function seedTxn() {
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
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(50_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  return {
    principalId: principal.id,
    agentId: agent.id,
    subWalletId: sw.sub.id,
    txnId: txn.id,
  };
}

describe('bumpWorkflowService.create', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates a pending bump_request + sets transaction.status=bump_pending + sets transaction.bump_request_id', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now,
    });
    expect(created.bumpRequest.status).toBe('pending');
    expect(created.bumpRequest.expiresAt.getTime() - now.getTime()).toBe(30 * 60 * 1000);
    const txn = await transactionsRepo.findById(testDb, txnId);
    expect(txn?.status).toBe('bump_pending');
    expect(txn?.bumpRequestId).toBe(created.bumpRequest.id);
  });

  it('respects custom TTL minutes', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now,
      ttlMinutes: 5,
    });
    expect(created.bumpRequest.expiresAt.getTime() - now.getTime()).toBe(5 * 60 * 1000);
  });

  it('dispatches a bump_requested notification to the principal', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const result = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    const row = await notificationsRepo.findByDedupeKey(
      testDb,
      principalId,
      'in_app',
      `bump:${result.bumpRequest.id}`,
    );
    expect(row?.status).toBe('sent');
  });
});

describe('bumpWorkflowService.decide', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('approve_once → status=approved_once + one-shot token issued', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now,
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id,
      decidedByUserId: principalId,
      decision: 'approve_once',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.bumpRequest.status).toBe('approved_once');
      expect(result.value.oneShotToken).not.toBeNull();
      expect(result.value.oneShotToken?.token).toMatch(/^[a-f0-9]{48}$/);
    }
  });

  it('deny → status=denied + no token', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id,
      decidedByUserId: principalId,
      decision: 'deny',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.bumpRequest.status).toBe('denied');
      expect(result.value.oneShotToken).toBeNull();
    }
  });

  it('returns BUMP_EXPIRED when now > expiresAt', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
      ttlMinutes: 5,
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id,
      decidedByUserId: principalId,
      decision: 'approve_once',
      now: new Date('2026-05-03T12:10:00Z'),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('BUMP_EXPIRED');
  });

  it('returns INVALID_TRANSITION when bump is already decided', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id,
      decidedByUserId: principalId,
      decision: 'approve_once',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id,
      decidedByUserId: principalId,
      decision: 'deny',
      now: new Date('2026-05-03T12:06:00Z'),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('bumpWorkflowService.sweepExpired', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('marks all pending bumps past expiresAt as expired', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
      ttlMinutes: 5,
    });
    const out = await bumpWorkflowService.sweepExpired(testDb, new Date('2026-05-03T12:10:00Z'));
    expect(out.expiredCount).toBe(1);
  });

  it('returns 0 when no bumps are due', async () => {
    const out = await bumpWorkflowService.sweepExpired(testDb, new Date('2026-05-03T12:00:00Z'));
    expect(out.expiredCount).toBe(0);
  });
});

describe('bumpWorkflowService.consumeToken', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the bump_request the first time and null the second', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId,
      subWalletId,
      requestedByUserId: agentId,
      amountKobo: kobo(50_000n),
      vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    const decision = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id,
      decidedByUserId: principalId,
      decision: 'approve_once',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    const tok = isOk(decision) ? decision.value.oneShotToken?.token : undefined;
    expect(tok).toBeDefined();

    const first = await bumpWorkflowService.consumeToken(
      testDb,
      tok as string,
      new Date('2026-05-03T12:06:00Z'),
    );
    expect(first?.id).toBe(created.bumpRequest.id);

    const second = await bumpWorkflowService.consumeToken(
      testDb,
      tok as string,
      new Date('2026-05-03T12:07:00Z'),
    );
    expect(second).toBeNull();
  });

  it('returns null for an unknown token', async () => {
    expect(await bumpWorkflowService.consumeToken(testDb, 'nope', new Date())).toBeNull();
  });
});
