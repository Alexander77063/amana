import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer();

async function seed() {
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
  return { principal, agent, mw, sw };
}

describe('VAS beneficiary CRUD routes', () => {
  beforeEach(truncateAll);

  it('POST /vas/beneficiaries — owning principal → 201', async () => {
    const { principal, sw } = await seed();
    const res = await app.request('/vas/beneficiaries', {
      method: 'POST',
      headers: await bearerHeaders(principal),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        kind: 'phone',
        value: '08099999999',
        label: 'Mum',
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { beneficiary: Record<string, unknown> };
    expect(json.beneficiary.label).toBe('Mum');
    expect(json.beneficiary.value).toBe('+2348099999999'); // normalized
    expect(json.beneficiary.active).toBe(true);
  });

  it('POST /vas/beneficiaries — the agent (non-owner of the funds) → 403', async () => {
    const { agent, sw } = await seed();
    const res = await app.request('/vas/beneficiaries', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        kind: 'phone',
        value: '08099999999',
        label: 'Mum',
      }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden');
  });

  it('POST /vas/beneficiaries — malformed body (missing subWalletId) → 400', async () => {
    const { principal } = await seed();
    const res = await app.request('/vas/beneficiaries', {
      method: 'POST',
      headers: await bearerHeaders(principal),
      body: JSON.stringify({ kind: 'phone', value: '08099999999', label: 'Mum' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /vas/beneficiaries?subWalletId= → 200 list of active rows', async () => {
    const { principal, sw } = await seed();
    const headers = await bearerHeaders(principal);
    await app.request('/vas/beneficiaries', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        kind: 'phone',
        value: '08099999999',
        label: 'Mum',
      }),
    });
    const res = await app.request(`/vas/beneficiaries?subWalletId=${sw.sub.id}`, { headers });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { beneficiaries: Array<Record<string, unknown>> };
    expect(json.beneficiaries.length).toBe(1);
    expect(json.beneficiaries[0]?.value).toBe('+2348099999999');
  });

  it('DELETE /vas/beneficiaries/:id — owning principal soft-removes it → 200; it drops from the list', async () => {
    const { principal, sw } = await seed();
    const headers = await bearerHeaders(principal);
    const created = (await (
      await app.request('/vas/beneficiaries', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subWalletId: sw.sub.id,
          kind: 'phone',
          value: '08099999999',
          label: 'Mum',
        }),
      })
    ).json()) as { beneficiary: { id: string } };

    const del = await app.request(`/vas/beneficiaries/${created.beneficiary.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(del.status).toBe(200);

    const list = (await (
      await app.request(`/vas/beneficiaries?subWalletId=${sw.sub.id}`, { headers })
    ).json()) as { beneficiaries: unknown[] };
    expect(list.beneficiaries.length).toBe(0);
  });

  it('DELETE /vas/beneficiaries/:id — the agent cannot remove → 403', async () => {
    const { principal, agent, sw } = await seed();
    const created = (await (
      await app.request('/vas/beneficiaries', {
        method: 'POST',
        headers: await bearerHeaders(principal),
        body: JSON.stringify({
          subWalletId: sw.sub.id,
          kind: 'phone',
          value: '08099999999',
          label: 'Mum',
        }),
      })
    ).json()) as { beneficiary: { id: string } };

    const del = await app.request(`/vas/beneficiaries/${created.beneficiary.id}`, {
      method: 'DELETE',
      headers: await bearerHeaders(agent),
    });
    expect(del.status).toBe(403);
  });

  it('GET /vas/beneficiaries — no bearer → 401', async () => {
    const res = await app.request(
      '/vas/beneficiaries?subWalletId=00000000-0000-0000-0000-000000000000',
    );
    expect(res.status).toBe(401);
  });
});
