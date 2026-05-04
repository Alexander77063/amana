import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { bumpWorkflowService } from '../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedBump(now: Date) {
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
  const created = await bumpWorkflowService.create(testDb, {
    transactionId: txn.id,
    subWalletId: sw.sub.id,
    requestedByUserId: agent.id,
    amountKobo: kobo(50_000n),
    vendorResolvedName: 'M',
    now,
  });
  return { principalId: principal.id, agentId: agent.id, bumpId: created.bumpRequest.id };
}

describe('POST /bumps/:id/decision', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('approve_once → 200 with one-shot token', async () => {
    const now = new Date();
    const { principalId, bumpId } = await seedBump(now);
    const app = createServer();
    const res = await app.request(`/bumps/${bumpId}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': principalId,
        'x-actor-role': 'principal',
      },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; oneShotToken: string | null };
    expect(body.status).toBe('approved_once');
    expect(body.oneShotToken).toMatch(/^[a-f0-9]{48}$/);
  });

  it('403 when actor role is not principal', async () => {
    const now = new Date();
    const { agentId, bumpId } = await seedBump(now);
    const app = createServer();
    const res = await app.request(`/bumps/${bumpId}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': agentId,
        'x-actor-role': 'agent',
      },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(403);
  });

  it('404 for unknown bump', async () => {
    const now = new Date();
    const { principalId } = await seedBump(now);
    const app = createServer();
    const res = await app.request(`/bumps/${factories.txnId()}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': principalId,
        'x-actor-role': 'principal',
      },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(404);
  });
});
