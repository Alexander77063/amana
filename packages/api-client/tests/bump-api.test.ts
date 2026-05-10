import { describe, expect, it, vi } from 'vitest';
import { BumpApi } from '../src/bump-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('BumpApi.listForMe', () => {
  it('GETs /me/bumps with no query when status not provided', async () => {
    const client = fakeClient(async () => ({ pending: [], history: [] }));
    const api = new BumpApi(client);
    await api.listForMe();
    expect(client.request).toHaveBeenCalledWith('/me/bumps');
  });

  it('GETs /me/bumps?status=pending when status=pending provided', async () => {
    const client = fakeClient(async () => ({ pending: [], history: [] }));
    const api = new BumpApi(client);
    await api.listForMe({ status: 'pending' });
    expect(client.request).toHaveBeenCalledWith('/me/bumps?status=pending');
  });

  it('returns the parsed pending/history shape', async () => {
    const client = fakeClient(async () => ({
      pending: [
        {
          id: 'b1',
          transactionId: 't1',
          subWalletId: 'sw1',
          requestedByUserId: 'u-agent',
          amountKobo: '50000',
          vendorResolvedName: 'MTN',
          agentNote: null,
          status: 'pending',
          expiresAt: '2026-05-06T01:00:00Z',
          decidedByUserId: null,
          decidedAt: null,
          createdAt: '2026-05-06T00:00:00Z',
        },
      ],
      history: [],
    }));
    const api = new BumpApi(client);
    const r = await api.listForMe();
    expect(r.pending[0]?.id).toBe('b1');
    expect(r.history).toHaveLength(0);
  });

  it("does not append ?status=all (server default) when status === 'all'", async () => {
    const client = fakeClient(async () => ({ pending: [], history: [] }));
    const api = new BumpApi(client);
    await api.listForMe({ status: 'all' });
    expect(client.request).toHaveBeenCalledWith('/me/bumps');
  });
});

describe('BumpApi.decide', () => {
  it('POSTs /bumps/:id/decision with decision body', async () => {
    const client = fakeClient(async () => ({ status: 'approved_once', oneShotToken: 'tok-abc' }));
    const api = new BumpApi(client);
    const r = await api.decide('b1', 'approve_once');
    expect(r.status).toBe('approved_once');
    expect(r.oneShotToken).toBe('tok-abc');
    expect(client.request).toHaveBeenCalledWith('/bumps/b1/decision', {
      method: 'POST',
      jsonBody: { decision: 'approve_once' },
    });
  });

  it('passes deny decision through', async () => {
    const client = fakeClient(async () => ({ status: 'denied', oneShotToken: null }));
    const api = new BumpApi(client);
    const r = await api.decide('b1', 'deny');
    expect(r.status).toBe('denied');
    expect(client.request).toHaveBeenCalledWith('/bumps/b1/decision', {
      method: 'POST',
      jsonBody: { decision: 'deny' },
    });
  });
});

describe('BumpApi.cancelBump', () => {
  it('DELETEs /transactions/:id/bump', async () => {
    const client = fakeClient(async () => ({ ok: true }));
    const api = new BumpApi(client);
    await api.cancelBump('txn-1');
    expect(client.request).toHaveBeenCalledWith('/transactions/txn-1/bump', {
      method: 'DELETE',
    });
  });
});
