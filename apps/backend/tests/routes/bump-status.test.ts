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

// GET /transactions/:id/bump is how the one-shot resume token reaches the agent's device.
// The token is a capability, so who can read it is the whole point of these tests.
const app = createServer();

async function scaffold() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    bvn: factories.bvn(),
    kycTier: '2',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'A' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '0000000001',
    anchorBankCode: '050',
    anchorAccountId: 'a-1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Allowance',
  });
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
    vendorAccount: '0123456789',
    vendorBankCode: '058',
    vendorResolvedName: 'V',
  });
  const now = new Date();
  const { bumpRequest } = await bumpWorkflowService.create(testDb, {
    transactionId: txn.id,
    subWalletId: sw.sub.id,
    requestedByUserId: agent.id,
    amountKobo: kobo(100_000n),
    vendorResolvedName: 'V',
    now,
  });
  return { principal, agent, txn, bumpRequest, now };
}

const get = async (txnId: string, auth: Record<string, string>) =>
  app.request(`/transactions/${txnId}/bump`, { headers: auth });

describe('GET /transactions/:id/bump', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('gives the owning agent the status, and no token while still pending', async () => {
    const { agent, txn } = await scaffold();
    const res = await get(txn.id, await bearerHeaders(agent));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; resumeToken: string | null };
    expect(body.status).toBe('pending');
    expect(body.resumeToken).toBeNull();
  });

  it('releases the resume token once the principal approves', async () => {
    const { principal, agent, txn, bumpRequest, now } = await scaffold();
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: bumpRequest.id,
      decidedByUserId: principal.id,
      decision: 'approve_once',
      now,
    });

    const res = await get(txn.id, await bearerHeaders(agent));
    const body = (await res.json()) as { status: string; resumeToken: string | null };
    expect(body.status).toBe('approved_once');
    expect(typeof body.resumeToken).toBe('string');
    expect(body.resumeToken).not.toHaveLength(0);
  });

  it('stops releasing the token once it has been consumed', async () => {
    const { principal, agent, txn, bumpRequest, now } = await scaffold();
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: bumpRequest.id,
      decidedByUserId: principal.id,
      decision: 'approve_once',
      now,
    });
    const first = (await (await get(txn.id, await bearerHeaders(agent))).json()) as {
      resumeToken: string;
    };
    await bumpWorkflowService.consumeToken(testDb, first.resumeToken, now);

    const second = (await (await get(txn.id, await bearerHeaders(agent))).json()) as {
      resumeToken: string | null;
    };
    expect(second.resumeToken).toBeNull();
  });

  it('never hands the token to a different agent', async () => {
    const { principal, txn, bumpRequest, now } = await scaffold();
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: bumpRequest.id,
      decidedByUserId: principal.id,
      decision: 'approve_once',
      now,
    });
    const stranger = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });

    const res = await get(txn.id, await bearerHeaders(stranger));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('resumeToken');
  });

  it('is agent-only — the principal uses the decision response, not this', async () => {
    const { principal, txn } = await scaffold();
    const res = await get(txn.id, await bearerHeaders(principal));
    expect(res.status).toBe(403);
  });

  it('400s on a malformed transaction id, and 404s on an unknown one', async () => {
    const { agent } = await scaffold();
    expect((await get('not-a-uuid', await bearerHeaders(agent))).status).toBe(400);
    expect((await get(factories.txnId(), await bearerHeaders(agent))).status).toBe(404);
  });
});
