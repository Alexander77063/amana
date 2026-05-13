import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock so it applies before server import resolves the module
vi.mock('../../src/modules/media/media.service', () => ({
  mediaService: {
    getUploadUrl: vi.fn().mockResolvedValue({
      uploadUrl: 'https://mock.s3.amazonaws.com/put?signed=1',
      key: 'media/txn-id/12345.jpg',
    }),
  },
}));

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

async function seedWithTxn() {
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
    anchorVirtualAccount: '0000000001',
    anchorBankCode: '058',
    anchorAccountId: 'a1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'sw',
  });
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(10_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  return { principal, agent, sw, txn };
}

describe('POST /media/upload-url', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 — returns uploadUrl and key', async () => {
    const { agent, txn } = await seedWithTxn();
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ transactionId: txn.id, contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploadUrl: string; key: string };
    expect(body.uploadUrl).toContain('s3');
    expect(body.key).toMatch(/^media\//);
  });

  it('404 — transaction not found', async () => {
    const { agent } = await seedWithTxn();
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        transactionId: '00000000-0000-0000-0000-000000000000',
        contentType: 'image/jpeg',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('401 — unauthenticated', async () => {
    const { txn } = await seedWithTxn();
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      body: JSON.stringify({ transactionId: txn.id, contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(401);
  });
});
