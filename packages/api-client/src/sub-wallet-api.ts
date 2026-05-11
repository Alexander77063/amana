import type {
  ActiveRuleSet,
  RuleInput,
  RuleRecord,
  SubWallet,
  SubWalletBalance,
  SubWalletSnoozeInput,
  SubWalletStatus,
  TransactionListResponse,
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

  snooze(subWalletId: string, until: string | null): Promise<{ snoozedUntil: string | null }> {
    return this.client.request<{ snoozedUntil: string | null }>(
      `/sub-wallets/${subWalletId}/snooze`,
      {
        method: 'PUT',
        jsonBody: { until } satisfies SubWalletSnoozeInput,
      },
    );
  }

  unsnooze(subWalletId: string): Promise<{ snoozedUntil: null }> {
    return this.client.request<{ snoozedUntil: null }>(`/sub-wallets/${subWalletId}/snooze`, {
      method: 'DELETE',
    });
  }

  getTransactions(
    subWalletId: string,
    cursor?: string,
    limit?: number,
  ): Promise<TransactionListResponse> {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const path = qs
      ? `/sub-wallets/${subWalletId}/transactions?${qs}`
      : `/sub-wallets/${subWalletId}/transactions`;
    return this.client.request<TransactionListResponse>(path);
  }
}
