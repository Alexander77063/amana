import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { kobo } from '../../src/lib/kobo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { ruleSetService } from '../../src/modules/rules/rule-set.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { hashAgentReference } from '../../src/integrations/anchor/narration';

const SECRET = 'whsec_e2e';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

// Capture the args the route passes through to adapter.transfer; assert on them
// to lock B1 (fromAccountId = anchor opaque ID, not NUBAN) and B2 (narration tag = hash of
// AGENT user_id, not sub-wallet id).
//
// vi.mock is hoisted to the top of the file before any `const` declarations run.
// vi.hoisted() runs in the same hoisted context, so we use it to declare the spy
// in a way that the vi.mock factory can safely reference it.
const { transferSpy } = vi.hoisted(() => ({ transferSpy: vi.fn() }));

vi.mock('../../src/integrations/anchor', async () => {
  const actual = await vi.importActual<typeof import('../../src/integrations/anchor')>(
    '../../src/integrations/anchor',
  );
  return {
    ...actual,
    anchorAdapterSingleton: {
      transfer: transferSpy,
      // The route only uses `transfer` from the singleton; other methods unused here.
    },
  };
});

describe('e2e: intent → evaluate → bump → resume → send → settle', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
    transferSpy.mockReset();
  });

  it('walks the full bump-and-settle path through the actual nip-out.send call', async () => {
    // Seed
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const ANCHOR_ACCT = 'anchor-acct-e2e-001';
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
      anchorAccountId: ANCHOR_ACCT,
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
    });
    const topup = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, topup.id, [
      { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
      { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
    ]);
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id, createdByUserId: principal.id,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 1_000n } }],
    });

    const app = createServer();
    const idempotencyKey = factories.idempotencyKey();
    const agentHeaders = { 'content-type': 'application/json', 'x-actor-user-id': agent.id, 'x-actor-role': 'agent' };
    const principalHeaders = { 'content-type': 'application/json', 'x-actor-user-id': principal.id, 'x-actor-role': 'principal' };

    // Pre-arm the Anchor mock: route the eventual send call to a PENDING response.
    transferSpy.mockResolvedValue({
      id: 'tr-e2e-1', status: 'PENDING', reference: idempotencyKey,
    });

    // 1. Intent
    const intentRes = await app.request('/transactions/intent', {
      method: 'POST', headers: agentHeaders,
      body: JSON.stringify({
        masterWalletId: mw.master.id, subWalletId: sw.sub.id,
        amountKobo: '10000', idempotencyKey,
        vendorBankCode: '058', vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M', category: null, agentNote: null,
      }),
    });
    const { transactionId } = await intentRes.json() as { transactionId: string };

    // 2. Evaluate (rule denies — limit is 1K, txn is 10K)
    const evalRes = await app.request(`/transactions/${transactionId}/evaluate`, {
      method: 'POST', headers: agentHeaders,
    });
    expect(evalRes.status).toBe(202);
    const { bumpRequestId } = await evalRes.json() as { bumpRequestId: string };

    // 3. Principal decides approve_once
    const decideRes = await app.request(`/bumps/${bumpRequestId}/decision`, {
      method: 'POST', headers: principalHeaders,
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    const { oneShotToken } = await decideRes.json() as { oneShotToken: string };

    // 4. Resume after bump (txn → in_flight)
    const resumeRes = await app.request(`/transactions/${transactionId}/resume-after-bump`, {
      method: 'POST', headers: agentHeaders,
      body: JSON.stringify({ token: oneShotToken }),
    });
    const resumeBody = await resumeRes.json() as { status: string };
    expect(resumeBody.status).toBe('in_flight');

    // 5. Send — exercises the real nip-out.service through the route, hitting the mocked adapter.
    const sendRes = await app.request(`/transactions/${transactionId}/send`, {
      method: 'POST', headers: agentHeaders,
    });
    expect(sendRes.status).toBe(202);

    // B1 + B2 assertions: lock the args we actually pass to Anchor.
    expect(transferSpy).toHaveBeenCalledTimes(1);
    const [transferArg, idempArg] = transferSpy.mock.calls[0] as [
      Parameters<typeof transferSpy>[0],
      string,
    ];
    expect(transferArg.fromAccountId).toBe(ANCHOR_ACCT); // B1: opaque Anchor ID, not NUBAN
    expect(transferArg.narration).toBe(`AMN/AGT/${hashAgentReference(agent.id)}/${hh.id}`); // B2: hash of agent user_id
    expect(idempArg).toBe(idempotencyKey);

    // 6. Webhook: transfer.completed
    const webhookBody = JSON.stringify({
      id: 'evt-e2e-1', type: 'transfer.completed', createdAt: '2026-05-03T12:00:30Z',
      data: { transferId: 'tr-e2e-1', reference: idempotencyKey, status: 'COMPLETED', nibssSessionId: 'sess-e2e' },
    });
    const webhookRes = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(webhookBody) },
      body: webhookBody,
    });
    expect(webhookRes.status).toBe(200);

    const finalTxn = await transactionsRepo.findById(testDb, transactionId);
    expect(finalTxn?.status).toBe('settled');
    expect(finalTxn?.nibssSessionId).toBe('sess-e2e');
  });
});
