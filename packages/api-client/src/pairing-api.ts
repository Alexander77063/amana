import type { PairingTokenIssued } from '@amana/types';
import type { AuthedClient } from './household-api';

export type IssuePairingInput = { householdId: string };
export type IssuePairingResult = PairingTokenIssued;

export class PairingApi {
  constructor(private readonly client: AuthedClient) {}

  issue(input: IssuePairingInput): Promise<IssuePairingResult> {
    return this.client.request<IssuePairingResult>('/pairing', {
      method: 'POST',
      jsonBody: input,
    });
  }

  complete(token: string): Promise<{ subWalletId: string | null }> {
    return this.client.request<{ subWalletId: string | null }>('/pairing/complete', {
      method: 'POST',
      jsonBody: { token },
    });
  }
}
