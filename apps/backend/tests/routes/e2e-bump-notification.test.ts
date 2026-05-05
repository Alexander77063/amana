import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { notificationsRepo } from '../../src/modules/notifications/notifications.repo';
import { ruleSetService } from '../../src/modules/rules/rule-set.service';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { bearerHeaders } from '../helpers/bearer';
import { testDb, truncateAll } from '../helpers/test-db';

const SECRET = 'whsec_e2e-notif';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

// Prevent real Expo HTTP calls. The push provider instantiates Expo at module
// load time, so we intercept the constructor via vi.mock.
vi.mock('expo-server-sdk', () => ({
  Expo: vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  })),
  isExpoPushToken: () => true,
}));

// Capture transfer spy for the Anchor adapter mock.
const { transferSpy } = vi.hoisted(() => ({ transferSpy: vi.fn() }));

vi.mock('../../src/integrations/anchor', async () => {
  const actual = await vi.importActual<typeof import('../../src/integrations/anchor')>(
    '../../src/integrations/anchor',
  );
  return {
    ...actual,
    anchorAdapterSingleton: {
      transfer: transferSpy,
    },
  };
});

describe('e2e: bump → notification → approve → settle (notification dispatch at each step)', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
    transferSpy.mockReset();
  });

  it('dispatches bump_requested and txn_settled notifications at the correct lifecycle steps', async () => {
    // ── Seed ──────────────────────────────────────────────────────────────────
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const ANCHOR_ACCT = 'anchor-acct-notif-001';
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id,
      anchorVirtualAccount: '1234567890',
      anchorBankCode: '058',
      anchorAccountId: ANCHOR_ACCT,
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
    // Fund the sub-wallet with 100K so balance isn't the constraint.
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
    // Publish rule set: daily limit of 1K. A 10K txn will be denied → bump created.
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 1_000n } }],
    });

    const app = createServer();
    const idempotencyKey = factories.idempotencyKey();
    const agentHeaders = await bearerHeaders(agent);
    const principalHeaders = await bearerHeaders(principal);

    // Pre-arm the Anchor mock: eventual send returns PENDING.
    transferSpy.mockResolvedValue({
      id: 'tr-notif-1',
      status: 'PENDING',
      reference: idempotencyKey,
    });

    // ── Step 1: Intent ─────────────────────────────────────────────────────────
    const intentRes = await app.request('/transactions/intent', {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        amountKobo: '10000',
        idempotencyKey,
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        vendorResolvedName: 'TestVendor',
        category: null,
        agentNote: null,
      }),
    });
    expect(intentRes.status).toBe(201);
    const { transactionId } = (await intentRes.json()) as { transactionId: string };

    // ── Step 2: Evaluate — rule denies (10K vs 1K daily limit) → bump created ─
    const evalRes = await app.request(`/transactions/${transactionId}/evaluate`, {
      method: 'POST',
      headers: agentHeaders,
    });
    expect(evalRes.status).toBe(202);
    const { bumpRequestId } = (await evalRes.json()) as { bumpRequestId: string };
    expect(bumpRequestId).toBeTruthy();

    // Assert: principal received a bump_requested in-app notification.
    // Dedupe key is `bump:${bumpRequestId}` (from bump-workflow.service.ts line 104).
    const bumpReqNotif = await notificationsRepo.findByDedupeKey(
      testDb,
      principal.id,
      'in_app',
      `bump:${bumpRequestId}`,
    );
    expect(bumpReqNotif).toBeDefined();
    expect(bumpReqNotif?.kind).toBe('bump_requested');

    // ── Step 3: Principal approves bump (approve_once) ─────────────────────────
    const decideRes = await app.request(`/bumps/${bumpRequestId}/decision`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(decideRes.status).toBe(200);
    const { oneShotToken } = (await decideRes.json()) as { oneShotToken: string };
    expect(oneShotToken).toBeTruthy();

    const bumpDecidedNotif = await notificationsRepo.findByDedupeKey(
      testDb,
      agent.id,
      'in_app',
      `bump-decided:${bumpRequestId}`,
    );
    expect(bumpDecidedNotif).toBeDefined();
    expect(bumpDecidedNotif?.kind).toBe('bump_decided');

    // ── Step 4: Resume after bump — txn moves to in_flight ────────────────────
    const resumeRes = await app.request(`/transactions/${transactionId}/resume-after-bump`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ token: oneShotToken }),
    });
    expect(resumeRes.status).toBe(200);
    const resumeBody = (await resumeRes.json()) as { status: string };
    expect(resumeBody.status).toBe('in_flight');

    // ── Step 5: Send — Anchor adapter returns PENDING ──────────────────────────
    const sendRes = await app.request(`/transactions/${transactionId}/send`, {
      method: 'POST',
      headers: agentHeaders,
    });
    expect(sendRes.status).toBe(202);
    expect(transferSpy).toHaveBeenCalledTimes(1);

    // ── Step 6: Webhook transfer.completed → settlement ────────────────────────
    const webhookBody = JSON.stringify({
      id: 'evt-notif-1',
      type: 'transfer.completed',
      createdAt: '2026-05-04T12:00:30Z',
      data: {
        transferId: 'tr-notif-1',
        reference: idempotencyKey,
        status: 'COMPLETED',
        nibssSessionId: 'sess-notif',
      },
    });
    const webhookRes = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(webhookBody) },
      body: webhookBody,
    });
    expect(webhookRes.status).toBe(200);

    // Confirm transaction settled.
    const finalTxn = await transactionsRepo.findById(testDb, transactionId);
    expect(finalTxn?.status).toBe('settled');

    // Assert: principal received a txn_settled in-app notification.
    // Dedupe key is `txn-settled:${txn.id}` (from settlement.service.ts line 128).
    const settledForPrincipal = await notificationsRepo.findByDedupeKey(
      testDb,
      principal.id,
      'in_app',
      `txn-settled:${transactionId}`,
    );
    expect(settledForPrincipal).toBeDefined();
    expect(settledForPrincipal?.kind).toBe('txn_settled');

    // Assert: agent also received a txn_settled in-app notification.
    // settlement.service dispatches to agentUserId when it differs from principalUserId.
    const settledForAgent = await notificationsRepo.findByDedupeKey(
      testDb,
      agent.id,
      'in_app',
      `txn-settled:${transactionId}`,
    );
    expect(settledForAgent).toBeDefined();
    expect(settledForAgent?.kind).toBe('txn_settled');
  });
});
