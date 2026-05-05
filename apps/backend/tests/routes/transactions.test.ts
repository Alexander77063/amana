import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

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
    masterId: mw.master.id,
    subWalletId: sw.sub.id,
    agentId: agent.id,
    agentUser: agent,
    principalId: principal.id,
  };
}

describe('POST /transactions/intent + evaluate', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('intent creates a DRAFT, evaluate moves to in_flight when no rules block', async () => {
    const { masterId, subWalletId, agentUser } = await seedFundedSubWallet();
    const app = createServer();
    const agentHeaders = await bearerHeaders(agentUser);
    const intentRes = await app.request('/transactions/intent', {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        masterWalletId: masterId,
        subWalletId,
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M',
        category: null,
        agentNote: null,
      }),
    });
    expect(intentRes.status).toBe(201);
    const intent = (await intentRes.json()) as { transactionId: string; status: string };
    expect(intent.status).toBe('draft');

    const evalRes = await app.request(`/transactions/${intent.transactionId}/evaluate`, {
      method: 'POST',
      headers: agentHeaders,
    });
    expect(evalRes.status).toBe(200);
    const evalBody = (await evalRes.json()) as { kind: string; status: string };
    expect(evalBody.kind).toBe('allow');
    expect(evalBody.status).toBe('in_flight');
  });

  it('rejects intent without bearer (401)', async () => {
    const { masterId, subWalletId } = await seedFundedSubWallet();
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        masterWalletId: masterId,
        subWalletId,
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M',
        category: null,
        agentNote: null,
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });
});
