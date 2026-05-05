import type {
  ActiveRuleSet,
  RuleInput,
  RuleRecord,
  SubWallet,
  SubWalletBalance,
  SubWalletStatus,
} from '@amana/types';
import type { AuthedClient } from './household-api';

export type PatchStatusInput = { status: SubWalletStatus };
export type GetBalanceResult = SubWalletBalance;
export type GetRulesResult = { activeRuleSet: ActiveRuleSet | null };
export type PublishRulesInput = { rules: RuleInput[] };
export type PublishRulesResult = {
  ruleSet: { id: string; version: number };
  rules: RuleRecord[];
};

export class SubWalletApi {
  constructor(private readonly client: AuthedClient) {}

  get(subWalletId: string): Promise<{ subWallet: SubWallet }> {
    return this.client.request<{ subWallet: SubWallet }>(`/sub-wallets/${subWalletId}`);
  }

  patchStatus(subWalletId: string, input: PatchStatusInput): Promise<{ subWallet: SubWallet }> {
    return this.client.request<{ subWallet: SubWallet }>(`/sub-wallets/${subWalletId}`, {
      method: 'PATCH',
      jsonBody: input,
    });
  }

  getBalance(subWalletId: string): Promise<GetBalanceResult> {
    return this.client.request<GetBalanceResult>(`/sub-wallets/${subWalletId}/balance`);
  }

  getRules(subWalletId: string): Promise<GetRulesResult> {
    return this.client.request<GetRulesResult>(`/sub-wallets/${subWalletId}/rules`);
  }

  publishRules(subWalletId: string, input: PublishRulesInput): Promise<PublishRulesResult> {
    return this.client.request<PublishRulesResult>(`/sub-wallets/${subWalletId}/rules`, {
      method: 'POST',
      jsonBody: input,
    });
  }
}
