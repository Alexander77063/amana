import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function makeHousehold(accountSuffix: string) {
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
  return { principal, agent, masterId: mw.master.id, subWalletId: sw.sub.id };
}

function intentBody(masterWalletId: string, subWalletId: string | null) {
  return JSON.stringify({
    masterWalletId,
    subWalletId,
    amountKobo: '5000',
    idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M',
    category: null,
    agentNote: null,
  });
}

describe('transaction route authorization', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("rejects an agent creating an intent on another household's sub-wallet (403)", async () => {
    const a = await makeHousehold('1');
    const b = await makeHousehold('2');
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: await bearerHeaders(b.agent), // agent B
      body: intentBody(a.masterId, a.subWalletId), // household A's wallet
    });
    expect(res.status).toBe(403);
  });

  it('rejects an agent attempting a principal-direct spend (subWalletId null) (403)', async () => {
    const a = await makeHousehold('1');
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: await bearerHeaders(a.agent),
      body: intentBody(a.masterId, null),
    });
    expect(res.status).toBe(403);
  });

  it('rejects an intent whose subWalletId does not belong to the given masterWalletId (403)', async () => {
    const a = await makeHousehold('1');
    const b = await makeHousehold('2');
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: await bearerHeaders(a.agent),
      body: intentBody(b.masterId, a.subWalletId), // own sub-wallet, wrong master
    });
    expect(res.status).toBe(403);
  });

  it('allows the principal to perform a direct spend on their own master wallet (201)', async () => {
    const a = await makeHousehold('1');
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: await bearerHeaders(a.principal),
      body: intentBody(a.masterId, null),
    });
    expect(res.status).toBe(201);
  });

  it('allows the owning agent to create an intent on their own sub-wallet (201)', async () => {
    const a = await makeHousehold('1');
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: await bearerHeaders(a.agent),
      body: intentBody(a.masterId, a.subWalletId),
    });
    expect(res.status).toBe(201);
  });

  it("rejects an agent evaluating another household's transaction (403)", async () => {
    const a = await makeHousehold('1');
    const b = await makeHousehold('2');
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: a.masterId,
      subWalletId: a.subWalletId,
      kind: 'spend',
      amountKobo: kobo(5000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/evaluate`, {
      method: 'POST',
      headers: await bearerHeaders(b.agent),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an agent sending another household's transaction (403, before any transfer)", async () => {
    const a = await makeHousehold('1');
    const b = await makeHousehold('2');
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: a.masterId,
      subWalletId: a.subWalletId,
      kind: 'spend',
      amountKobo: kobo(5000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await testDb.execute(sql`UPDATE transactions SET status='in_flight' WHERE id = ${txn.id}`);
    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/send`, {
      method: 'POST',
      headers: await bearerHeaders(b.agent),
    });
    expect(res.status).toBe(403);
  });
});
