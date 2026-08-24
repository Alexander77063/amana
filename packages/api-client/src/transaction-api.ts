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

export type SendResult = { anchorTransferId: string; status: string };

export type BumpStatusResult = {
  status: 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired' | 'cancelled';
  expiresAt: string;
  /** Present only once approved — this is what `resumeAfterBump` consumes. */
  resumeToken: string | null;
};

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

  /**
   * POST /transactions/:id/send — hands the payout to the bank rail.
   *
   * This is the step that actually moves money. `evaluate` only clears the rules and marks
   * the transaction in_flight; without this call the payout is never initiated and the
   * transaction sits in_flight until the agent's poll gives up.
   *
   * Safe to call more than once: the transfer is idempotent at Anchor on the transaction's
   * idempotency key, so a retry resolves to the same transfer rather than paying twice.
   */
  send(transactionId: string): Promise<SendResult> {
    return this.client.request<SendResult>(
      `/transactions/${encodeURIComponent(transactionId)}/send`,
      { method: 'POST' },
    );
  }

  /**
   * GET /transactions/:id/bump — the agent's view of the bump on their own transaction.
   *
   * `resumeToken` is non-null only once the principal has approved. It is fetched over the
   * agent's own authenticated connection rather than carried in the push, so polling this is
   * what keeps a dropped notification from stranding the payment.
   */
  bumpStatus(transactionId: string): Promise<BumpStatusResult> {
    return this.client.request<BumpStatusResult>(
      `/transactions/${encodeURIComponent(transactionId)}/bump`,
    );
  }

  /** POST /transactions/:id/resume-after-bump — continue a spend the principal approved. */
  resumeAfterBump(transactionId: string, token: string): Promise<{ status: string }> {
    return this.client.request<{ status: string }>(
      `/transactions/${encodeURIComponent(transactionId)}/resume-after-bump`,
      { method: 'POST', jsonBody: { token } },
    );
  }
}
