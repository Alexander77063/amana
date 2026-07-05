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
  | 'kyc.rejected'
  | 'bills.initiated'
  | 'bills.successful'
  | 'bills.failed';

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

export interface AnchorCreateCustomerRequest {
  phoneNumber: string;
  nin: string;
  bvn: string;
  fullName?: string;
}

export interface AnchorCreateCustomerResponse {
  id: string;
  fullName: string;
  phoneNumber: string;
  kycLevel: 'TIER_1' | 'TIER_2' | 'TIER_3';
}

// ── Digital VAS (bill payment) ──────────────────────────────────────────────
// Flat internal contract, mirroring the transfer methods above (kobo bigint on
// the request, serialized as a string by bigintReplacer). NOT Anchor's public
// nested JSON:API shape — see the VAS adapter methods for the rationale.

export type VasBillType = 'Airtime' | 'Data' | 'Electricity' | 'CableTV';

export interface AnchorBiller {
  id: string;
  name: string;
  slug: string;
}

export interface AnchorBillProduct {
  id: string;
  name: string;
  slug: string;
  amountKobo: bigint | null; // fixed-price products (data plans); null = variable (airtime)
}

export interface AnchorCustomerValidation {
  customerNumber: string;
  customerName: string;
}

// FLAT request body — mirrors AnchorTransferRequest (amountKobo: bigint, serialized as a
// kobo string by bigintReplacer). Do NOT nest under data/attributes.
export interface AnchorBillRequest {
  type: VasBillType;
  provider?: string; // biller slug (airtime/data)
  productSlug?: string; // data plan / disco product
  phoneNumber?: string; // airtime/data recipient
  meterAccountNumber?: string; // electricity/cable recipient
  amountKobo: bigint; // kobo (bigint → string on the wire)
  reference: string; // = idempotency key
  accountId: string; // Anchor DepositAccount id (Amana's operating account)
}

// FLAT response — mirrors AnchorTransferResponse. commissionKobo/token/failureReason are the
// assumed field names of the flat internal contract (verified when the live-E2E gate closes).
export interface AnchorBillResponse {
  id: string;
  status: 'PENDING' | 'INITIATED' | 'COMPLETED' | 'FAILED';
  commissionKobo: bigint;
  token: string | null; // prepaid electricity token when present
  failureReason?: string | null;
}

// Webhook payload (flat, mirrors AnchorTransferEventData). `reference` = our idempotency key.
export interface AnchorBillEventData {
  billId: string;
  reference: string;
  commissionKobo?: bigint | string;
  token?: string | null;
  failureReason?: string | null;
}

export interface AnchorKycApprovedData {
  customerId: string;
  newKycLevel: 'TIER_2' | 'TIER_3';
}

export interface AnchorKycRejectedData {
  customerId: string;
  reason: string;
}
