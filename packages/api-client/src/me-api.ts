import type { SubWalletWithPrincipal, User } from '@amana/types';
import type { AuthedClient } from './household-api';

export class MeApi {
  constructor(private readonly client: AuthedClient) {}

  get(): Promise<User> {
    return this.client.request<User>('/me');
  }

  getSubWallet(): Promise<SubWalletWithPrincipal> {
    return this.client.request<SubWalletWithPrincipal>('/me/sub-wallet');
  }
}
