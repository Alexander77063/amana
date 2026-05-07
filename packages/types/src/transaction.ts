export type TransactionStatus =
  | 'draft'
  | 'rule_eval'
  | 'bump_pending'
  | 'in_flight'
  | 'settled'
  | 'failed'
  | 'reversed';

export type TransactionKind = 'spend' | 'topup' | 'refund' | 'fee' | 'reversal';

export type TransactionInitiatorRole = 'principal' | 'agent';

export type TransactionDetail = {
  id: string;
  kind: TransactionKind;
  status: TransactionStatus;
  /** BigInt-safe — string over the wire. */
  amountKobo: string;

  // Vendor — null on topups, fees, reversals, or when capture was incomplete.
  vendorResolvedName: string | null;
  /** Last-4 form like "***1234"; full account never leaves the server. */
  vendorAccountMasked: string | null;
  vendorBankCode: string | null;
  category: string | null;

  /** null on principal direct-spend (decision #17). */
  subWallet: { id: string; name: string } | null;

  /**
   * Reconstructed from the existing FK graph (no `initiated_by_user_id` column at v1).
   * For agent-initiated txns: derived from `sub_wallets.agent_user_id`.
   * For principal direct-spend: `households.principal_user_id`.
   * Mobile renders `displayName` as "You" when role === 'principal'.
   */
  initiatedBy: { userId: string; displayName: string; role: TransactionInitiatorRole };
  /** ISO8601 — `transactions.created_at`. */
  initiatedAt: string;

  /** ISO8601 — populated when `status === 'settled'`. Null otherwise. */
  settledAt: string | null;
  /** Surface prominently when present (receipt proof). */
  nibssSessionId: string | null;
  /** Populated when `status === 'failed'` (added in this slice via 0018 migration). */
  errorMessage: string | null;

  // Agent context (Q3-B in spec).
  agentNote: string | null;
  /** 0..1 — mobile renders the badge only when ≥ 0.85. */
  anomalyScore: number | null;

  /** Decoded from PostGIS point on the server. Null when not captured. */
  geolocation: { lat: number; lng: number } | null;

  // FORWARD: attachedMedia (signed URLs), bumpDecision metadata, reversedAt — see 6b-6 spec §Out-of-scope.
};

export type TransactionDetailResponse = {
  transaction: TransactionDetail;
};
