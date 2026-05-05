import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdMembersRepo } from '../../src/modules/identity/household-members.repo';
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

async function seedHouseholdWithSubWallet() {
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
    anchorVirtualAccount: '0123456789',
    anchorBankCode: '058',
    anchorAccountId: 'a-1',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  await householdMembersRepo.add(testDb, hh.id, agent.id);
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { principal, agent, hh, mw, sw };
}

describe('GET /sub-wallets/:id', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns sub-wallet for owner principal', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subWallet: { name: string } };
    expect(body.subWallet.name).toBe('Driver');
  });

  it('403 not_your_sub_wallet for a different principal', async () => {
    const { sw } = await seedHouseholdWithSubWallet();
    const otherPrincipal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(otherPrincipal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, { headers });
    expect(res.status).toBe(403);
  });

  it('404 sub_wallet_not_found for unknown id', async () => {
    const { principal } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request('/sub-wallets/00000000-0000-0000-0000-000000000000', { headers });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /sub-wallets/:id', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('suspends a sub-wallet', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subWallet: { status: string } };
    expect(body.subWallet.status).toBe('suspended');
  });

  it('400 invalid_status', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'whatever' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /sub-wallets/:id/balance', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns balanceKobo as a string', async () => {
    const { principal, sw, mw } = await seedHouseholdWithSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      kind: 'topup',
      amountKobo: kobo(75_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(75_000n), creditKobo: kobo(0n) },
      {
        ledgerAccountId: mw.ledgerAccountIds.suspense,
        debitKobo: kobo(0n),
        creditKobo: kobo(75_000n),
      },
    ]);
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/balance`, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balanceKobo: '75000' });
  });
});

describe('GET /sub-wallets/:id/rules', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns null activeRuleSet when none published', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/rules`, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeRuleSet: null });
  });
});

describe('POST /sub-wallets/:id/rules', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('publishes a new rule set version', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        rules: [
          { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '100000' } },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ruleSet: { version: number };
      rules: Array<{ kind: string }>;
    };
    expect(body.ruleSet.version).toBe(1);
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].kind).toBe('limit');
    const get = await app.request(`/sub-wallets/${sw.sub.id}/rules`, { headers });
    const getBody = (await get.json()) as {
      activeRuleSet: { version: number; rules: Array<unknown> };
    };
    expect(getBody.activeRuleSet.version).toBe(1);
    expect(getBody.activeRuleSet.rules).toHaveLength(1);
  });

  it('a second publish increments the version', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    await app.request(`/sub-wallets/${sw.sub.id}/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        rules: [
          { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '100000' } },
        ],
      }),
    });
    const r2 = await app.request(`/sub-wallets/${sw.sub.id}/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '50000' } }],
      }),
    });
    expect(r2.status).toBe(201);
    const body = (await r2.json()) as { ruleSet: { version: number } };
    expect(body.ruleSet.version).toBe(2);
  });
});
