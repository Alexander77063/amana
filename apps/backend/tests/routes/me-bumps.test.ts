import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { bumpWorkflowService } from '../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedPendingBump() {
  const now = new Date();
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
  return { principal, agent, bumpId: created.bumpRequest.id };
}

describe('GET /me/bumps', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns pending + empty history for a principal with one open bump', async () => {
    const { principal, bumpId } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: { id: string; status: string }[];
      history: unknown[];
    };
    expect(body.pending.map((b) => b.id)).toContain(bumpId);
    expect(body.history).toHaveLength(0);
  });

  it('returns 403 when actor is an agent', async () => {
    const { agent } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps', {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(403);
  });

  it('?status=pending returns only pending', async () => {
    const { principal } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps?status=pending', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: unknown[]; history: unknown[] };
    expect(body.pending.length).toBeGreaterThan(0);
    expect(body.history).toHaveLength(0);
  });

  it('?status=history returns only history (empty when nothing decided)', async () => {
    const { principal } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps?status=history', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: unknown[]; history: unknown[] };
    expect(body.pending).toHaveLength(0);
    expect(body.history).toHaveLength(0);
  });

  it('returns 400 for unknown status value', async () => {
    const { principal } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps?status=banana', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(400);
  });
});
