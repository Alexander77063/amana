import type { BumpDecideResult, BumpDecision, MyBumpsResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export type ListForMeInput = { status?: 'pending' | 'history' | 'all' };

export class BumpApi {
  constructor(private readonly client: AuthedClient) {}

  listForMe(input?: ListForMeInput): Promise<MyBumpsResponse> {
    // status === 'all' is the server default; only send the query string for non-default values.
    const path =
      input?.status && input.status !== 'all' ? `/me/bumps?status=${input.status}` : '/me/bumps';
    return this.client.request<MyBumpsResponse>(path);
  }

  decide(bumpRequestId: string, decision: BumpDecision): Promise<BumpDecideResult> {
    return this.client.request<BumpDecideResult>(`/bumps/${bumpRequestId}/decision`, {
      method: 'POST',
      jsonBody: { decision },
    });
  }

  async cancelBump(transactionId: string): Promise<void> {
    await this.client.request<{ ok: boolean }>(
      `/transactions/${encodeURIComponent(transactionId)}/bump`,
      { method: 'DELETE' },
    );
  }
}
