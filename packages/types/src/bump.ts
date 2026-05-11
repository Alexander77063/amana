export type BumpStatus = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired' | 'cancelled';

export type BumpDecision = 'approve_once' | 'approve_raise_limit' | 'deny';

export type BumpRequest = {
  id: string;
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: string; // BigInt-safe over the wire
  vendorResolvedName: string;
  agentNote: string | null;
  status: BumpStatus;
  expiresAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type MyBumpsResponse = {
  pending: BumpRequest[];
  history: BumpRequest[];
};

export type BumpDecideResult = {
  status: BumpStatus;
  oneShotToken: string | null;
};
