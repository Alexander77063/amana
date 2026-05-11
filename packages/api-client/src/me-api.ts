import type { SubWalletWithPrincipal } from '@amana/types';
import type { AuthedClient } from './household-api';

export class MeApi {
  constructor(private readonly client: AuthedClient) {}

  getSubWallet(): Promise<SubWalletWithPrincipal> {
    return this.client.request<SubWalletWithPrincipal>('/me/sub-wallet');
  }
}
