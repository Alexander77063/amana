import { describe, expect, it, vi } from 'vitest';
import { SubWalletApi } from '../src/sub-wallet-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('SubWalletApi.get', () => {
  it('GETs /sub-wallets/:id', async () => {
    const client = fakeClient(async () => ({
      subWallet: {
        id: 'sw1',
        masterWalletId: 'mw1',
        agentUserId: 'u2',
        name: 'Groceries',
        status: 'active',
        createdAt: '2026-05-05T00:00:00Z',
      },
    }));
    const api = new SubWalletApi(client);
    const r = await api.get('sw1');
    expect(r.subWallet.status).toBe('active');
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw1');
  });
});

describe('SubWalletApi.patchStatus', () => {
  it('PATCHes /sub-wallets/:id with status body', async () => {
    const client = fakeClient(async () => ({
      subWallet: {
        id: 'sw1',
        masterWalletId: 'mw1',
        agentUserId: 'u2',
        name: 'Groceries',
        status: 'suspended',
        createdAt: '2026-05-05T00:00:00Z',
      },
    }));
    const api = new SubWalletApi(client);
    const r = await api.patchStatus('sw1', { status: 'suspended' });
    expect(r.subWallet.status).toBe('suspended');
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw1', {
      method: 'PATCH',
      jsonBody: { status: 'suspended' },
    });
  });
});

describe('SubWalletApi.getBalance', () => {
  it('GETs /sub-wallets/:id/balance and returns kobo as string', async () => {
    const client = fakeClient(async () => ({ balanceKobo: '12345' }));
    const api = new SubWalletApi(client);
    const r = await api.getBalance('sw1');
    expect(r.balanceKobo).toBe('12345');
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw1/balance');
  });
});

describe('SubWalletApi.getRules', () => {
  it('GETs /sub-wallets/:id/rules', async () => {
    const client = fakeClient(async () => ({
      activeRuleSet: {
        ruleSetId: 'rs1',
        version: 1,
        rules: [
          {
            id: 'r1',
            kind: 'limit',
            priority: 10,
            configJson: { windowKind: 'daily', maxKobo: '100000' },
          },
        ],
      },
    }));
    const api = new SubWalletApi(client);
    const r = await api.getRules('sw1');
    expect(r.activeRuleSet?.version).toBe(1);
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw1/rules');
  });

  it('returns null when no active rule set', async () => {
    const client = fakeClient(async () => ({ activeRuleSet: null }));
    const api = new SubWalletApi(client);
    const r = await api.getRules('sw1');
    expect(r.activeRuleSet).toBeNull();
  });
});

describe('SubWalletApi.publishRules', () => {
  it('POSTs /sub-wallets/:id/rules with rules array', async () => {
    const client = fakeClient(async () => ({
      ruleSet: { id: 'rs2', version: 2 },
      rules: [{ id: 'r1', kind: 'limit', priority: 10, configJson: {} }],
    }));
    const api = new SubWalletApi(client);
    const r = await api.publishRules('sw1', {
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '100000' } }],
    });
    expect(r.ruleSet.version).toBe(2);
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw1/rules', {
      method: 'POST',
      jsonBody: {
        rules: [
          { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '100000' } },
        ],
      },
    });
  });
});

describe('SubWalletApi.getTransactions', () => {
  it('GETs /sub-wallets/:id/transactions with cursor', async () => {
    const payload = {
      transactions: [{ id: 'txn1', kind: 'spend', status: 'settled', amountKobo: '5000',
        vendorResolvedName: 'Vendor', vendorAccountMasked: '***1234',
        initiatedAt: '2026-05-09T10:00:00Z', settledAt: '2026-05-09T10:01:00Z' }],
      nextCursor: 'txn1',
    };
    const client = fakeClient(async () => payload);
    const api = new SubWalletApi(client);
    const r = await api.getTransactions('sw1', 'cursor-id', 10);
    expect(r.transactions).toHaveLength(1);
    expect(r.nextCursor).toBe('txn1');
    expect(client.request).toHaveBeenCalledWith(
      '/sub-wallets/sw1/transactions?cursor=cursor-id&limit=10',
    );
  });

  it('GETs without cursor when not provided', async () => {
    const client = fakeClient(async () => ({ transactions: [], nextCursor: null }));
    const api = new SubWalletApi(client);
    await api.getTransactions('sw1');
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw1/transactions');
  });
});
