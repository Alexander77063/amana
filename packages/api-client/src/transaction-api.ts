import type { TransactionDetailResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export class TransactionApi {
  constructor(private readonly client: AuthedClient) {}

  /** GET /transactions/:id — principal-only on the server. */
  getById(transactionId: string): Promise<TransactionDetailResponse> {
    return this.client.request<TransactionDetailResponse>(
      `/transactions/${encodeURIComponent(transactionId)}`,
    );
  }
}
