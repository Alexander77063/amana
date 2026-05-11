import type { TransactionDetailResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export type CreateIntentInput = {
  masterWalletId: string;
  subWalletId: string | null;
  amountKobo: string;
  idempotencyKey: string;
  vendorBankCode: string;
  vendorAccountNumber: string;
  vendorResolvedName: string;
  category: string | null;
  agentNote: string | null;
  geolocation: { lat: number; lng: number } | null;
};

export type CreateIntentResult = { transactionId: string; status: string };

export type EvaluateResult =
  | { kind: 'allow'; status: string }
  | { kind: 'bump_pending'; bumpRequestId: string; status: string; expiresAt: string };

export class TransactionApi {
  constructor(private readonly client: AuthedClient) {}

  /** GET /transactions/:id — principal-only on the server. */
  getById(transactionId: string): Promise<TransactionDetailResponse> {
    return this.client.request<TransactionDetailResponse>(
      `/transactions/${encodeURIComponent(transactionId)}`,
    );
  }

  createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    return this.client.request<CreateIntentResult>('/transactions/intent', {
      method: 'POST',
      jsonBody: input,
    });
  }

  evaluate(transactionId: string): Promise<EvaluateResult> {
    return this.client.request<EvaluateResult>(
      `/transactions/${encodeURIComponent(transactionId)}/evaluate`,
      { method: 'POST' },
    );
  }
}
