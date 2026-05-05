import { describe, expect, it, vi } from 'vitest';
import { HouseholdApi } from '../src/household-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('HouseholdApi.createHousehold', () => {
  it('POSTs /households with name body', async () => {
    const client = fakeClient(async () => ({
      household: { id: 'h1', name: 'Adegbola Family', principalUserId: 'u1' },
      masterWallet: {
        id: 'mw1',
        anchorVirtualAccount: '9000123456',
        anchorBankCode: '999',
        currency: 'NGN',
      },
    }));
    const api = new HouseholdApi(client);
    const r = await api.createHousehold({ name: 'Adegbola Family' });
    expect(r.household.id).toBe('h1');
    expect(r.masterWallet.anchorVirtualAccount).toBe('9000123456');
    expect(client.request).toHaveBeenCalledWith('/households', {
      method: 'POST',
      jsonBody: { name: 'Adegbola Family' },
    });
  });
});

describe('HouseholdApi.getMyHousehold', () => {
  it('GETs /me/household', async () => {
    const client = fakeClient(async () => ({
      household: { id: 'h1', name: 'Adegbola Family', principalUserId: 'u1' },
      masterWallet: {
        id: 'mw1',
        anchorVirtualAccount: '9000123456',
        anchorBankCode: '999',
        currency: 'NGN',
        status: 'active',
      },
    }));
    const api = new HouseholdApi(client);
    const r = await api.getMyHousehold();
    expect(r.masterWallet.status).toBe('active');
    expect(client.request).toHaveBeenCalledWith('/me/household');
  });
});

describe('HouseholdApi.listMembers', () => {
  it('GETs /me/household/members', async () => {
    const client = fakeClient(async () => ({
      members: [
        {
          userId: 'u1',
          phone: '+2348012345678',
          role: 'principal',
          kycTier: '1',
          status: 'active',
          joinedAt: '2026-05-05T00:00:00Z',
        },
      ],
    }));
    const api = new HouseholdApi(client);
    const r = await api.listMembers();
    expect(r.members).toHaveLength(1);
    expect(r.members[0]?.role).toBe('principal');
    expect(client.request).toHaveBeenCalledWith('/me/household/members');
  });
});

describe('HouseholdApi.listSubWallets', () => {
  it('GETs /households/:id/sub-wallets', async () => {
    const client = fakeClient(async () => ({ subWallets: [] }));
    const api = new HouseholdApi(client);
    const r = await api.listSubWallets('h1');
    expect(r.subWallets).toEqual([]);
    expect(client.request).toHaveBeenCalledWith('/households/h1/sub-wallets');
  });
});

describe('HouseholdApi.createSubWallet', () => {
  it('POSTs /households/:id/sub-wallets', async () => {
    const client = fakeClient(async () => ({
      subWallet: {
        id: 'sw1',
        masterWalletId: 'mw1',
        agentUserId: 'u2',
        name: 'Groceries',
        status: 'active',
        createdAt: '2026-05-05T00:00:00Z',
      },
      ledgerAccountId: 'la1',
    }));
    const api = new HouseholdApi(client);
    const r = await api.createSubWallet('h1', { agentUserId: 'u2', name: 'Groceries' });
    expect(r.subWallet.name).toBe('Groceries');
    expect(r.ledgerAccountId).toBe('la1');
    expect(client.request).toHaveBeenCalledWith('/households/h1/sub-wallets', {
      method: 'POST',
      jsonBody: { agentUserId: 'u2', name: 'Groceries' },
    });
  });

  it('propagates ApiError on 400', async () => {
    const err = Object.assign(new Error('agent_not_paired'), {
      name: 'ApiError',
      status: 400,
      code: 'agent_not_paired',
    });
    const client = fakeClient(async () => {
      throw err;
    });
    const api = new HouseholdApi(client);
    await expect(api.createSubWallet('h1', { agentUserId: 'u2', name: 'x' })).rejects.toMatchObject(
      { code: 'agent_not_paired' },
    );
  });
});
