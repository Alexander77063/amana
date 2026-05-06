import type { BumpDecideResult, BumpDecision, MyBumpsResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export type ListForMeInput = { status?: 'pending' | 'history' | 'all' };

export class BumpApi {
  constructor(private readonly client: AuthedClient) {}

  listForMe(input?: ListForMeInput): Promise<MyBumpsResponse> {
    const path = input?.status ? `/me/bumps?status=${input.status}` : '/me/bumps';
    return this.client.request<MyBumpsResponse>(path);
  }

  decide(bumpRequestId: string, decision: BumpDecision): Promise<BumpDecideResult> {
    return this.client.request<BumpDecideResult>(`/bumps/${bumpRequestId}/decision`, {
      method: 'POST',
      jsonBody: { decision },
    });
  }
}
