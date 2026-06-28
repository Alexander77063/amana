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

async function seedPendingBump(accountSuffix: string) {
  const now = new Date();
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: `000000000${accountSuffix}`,
    anchorBankCode: '058',
    anchorAccountId: `anchor-${accountSuffix}`,
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
  return { principal, bumpId: created.bumpRequest.id };
}

describe('POST /bumps/:id/decision — household ownership', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("rejects a principal deciding another household's bump (404)", async () => {
    const a = await seedPendingBump('1');
    const b = await seedPendingBump('2');
    const app = createServer();
    const res = await app.request(`/bumps/${a.bumpId}/decision`, {
      method: 'POST',
      headers: await bearerHeaders(b.principal), // principal B
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(404);
  });

  it('allows the owning household principal to decide their bump (200)', async () => {
    const a = await seedPendingBump('1');
    const app = createServer();
    const res = await app.request(`/bumps/${a.bumpId}/decision`, {
      method: 'POST',
      headers: await bearerHeaders(a.principal),
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(200);
  });
});
