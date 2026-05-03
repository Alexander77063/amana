// Typed wrappers for Anchor's REST API surface used by Amana.
// Source: https://docs.getanchor.co (resource model and field names may evolve;
// keep this file aligned with the live docs).

export interface AnchorVirtualAccount {
  id: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  customerId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface AnchorCustomer {
  id: string;
  fullName: string;
  phoneNumber: string;
  bvn?: string;
  nin: string;
  kycLevel: 'TIER_1' | 'TIER_2' | 'TIER_3';
}

export interface AnchorNameEnquiryRequest {
  bankCode: string;
  accountNumber: string;
}

export interface AnchorNameEnquiryResponse {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  bvnLinked?: string;
}

export interface AnchorPhoneLookupRequest {
  phoneNumber: string;
}

export interface AnchorPhoneLookupResponse {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  phoneNumber: string;
}

export interface AnchorTransferRequest {
  amountKobo: bigint;
  fromAccountId: string;
  toBankCode: string;
  toAccountNumber: string;
  narration: string;
  reference: string; // = our idempotency key
}

export interface AnchorTransferResponse {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  reference: string;
  nibssSessionId?: string;
  failureReason?: string;
}

export interface AnchorKycUpgradeRequest {
  customerId: string;
  targetTier: 'TIER_3';
  documents: Array<{ kind: 'PROOF_OF_ADDRESS' | 'GOVT_ID'; url: string }>;
}

export interface AnchorKycUpgradeResponse {
  customerId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  newKycLevel?: 'TIER_3';
}

// Webhook event envelope.
export interface AnchorWebhookEvent<T = unknown> {
  id: string;
  type: AnchorWebhookEventType;
  createdAt: string; // ISO8601
  data: T;
}

export type AnchorWebhookEventType =
  | 'transfer.completed'
  | 'transfer.failed'
  | 'virtual_account.credited'
  | 'kyc.approved'
  | 'kyc.rejected';

export interface AnchorTransferEventData {
  transferId: string;
  reference: string;
  status: 'COMPLETED' | 'FAILED';
  nibssSessionId?: string;
  failureReason?: string;
}

export interface AnchorVirtualAccountCreditedData {
  virtualAccountId: string;
  amountKobo: bigint;
  senderBankCode: string;
  senderAccountNumber: string;
  senderAccountName: string;
  nibssSessionId: string;
}
