import type {
  HouseholdMember,
  HouseholdSnapshot,
  ProvisionedSubWallet,
  SubWallet,
} from '@amana/types';
import type { RequestInit2 } from './client';

export interface AuthedClient {
  request<T>(path: string, init?: RequestInit2): Promise<T>;
}

export type CreateHouseholdInput = { name: string };
export type CreateHouseholdResult = HouseholdSnapshot;
export type GetMyHouseholdResult = HouseholdSnapshot;
export type CreateSubWalletInput = { agentUserId: string; name: string };
export type CreateSubWalletResult = ProvisionedSubWallet;

export class HouseholdApi {
  constructor(private readonly client: AuthedClient) {}

  createHousehold(input: CreateHouseholdInput): Promise<CreateHouseholdResult> {
    return this.client.request<CreateHouseholdResult>('/households', {
      method: 'POST',
      jsonBody: input,
    });
  }

  getMyHousehold(): Promise<GetMyHouseholdResult> {
    return this.client.request<GetMyHouseholdResult>('/me/household');
  }

  listMembers(): Promise<{ members: HouseholdMember[] }> {
    return this.client.request<{ members: HouseholdMember[] }>('/me/household/members');
  }

  listSubWallets(householdId: string): Promise<{ subWallets: SubWallet[] }> {
    return this.client.request<{ subWallets: SubWallet[] }>(
      `/households/${householdId}/sub-wallets`,
    );
  }

  createSubWallet(
    householdId: string,
    input: CreateSubWalletInput,
  ): Promise<CreateSubWalletResult> {
    return this.client.request<CreateSubWalletResult>(`/households/${householdId}/sub-wallets`, {
      method: 'POST',
      jsonBody: input,
    });
  }
}
