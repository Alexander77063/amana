import type { TransactionDetailResponse } from '@amana/types';
import { describe, expect, it, vi } from 'vitest';
import { TransactionApi } from '../src/transaction-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

const fixtureResponse: TransactionDetailResponse = {
  transaction: {
    id: 'txn-1',
    kind: 'spend',
    status: 'settled',
    amountKobo: '12300',
    vendorResolvedName: 'V',
    vendorAccountMasked: '***6789',
    vendorBankCode: '058',
    category: null,
    subWallet: { id: 'sw-1', name: 'Allowance' },
    initiatedBy: { userId: 'u-2', displayName: 'Allowance', role: 'agent' },
    initiatedAt: '2026-05-07T12:00:00.000Z',
    settledAt: '2026-05-07T12:01:00.000Z',
    nibssSessionId: '100005031234',
    errorMessage: null,
    agentNote: null,
    anomalyScore: null,
    geolocation: null,
  },
};

describe('TransactionApi.getById', () => {
  it('GETs /transactions/:id and returns the parsed body', async () => {
    const client = fakeClient(async () => fixtureResponse);
    const api = new TransactionApi(client);
    const r = await api.getById('txn-1');
    expect(r.transaction.id).toBe('txn-1');
    expect(r.transaction.amountKobo).toBe('12300');
    expect(client.request).toHaveBeenCalledWith('/transactions/txn-1');
  });

  it('URL-encodes the transactionId path segment', async () => {
    const client = fakeClient(async () => fixtureResponse);
    const api = new TransactionApi(client);
    await api.getById('id with spaces');
    expect(client.request).toHaveBeenCalledWith('/transactions/id%20with%20spaces');
  });
});
