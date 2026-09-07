export type Role = 'owner' | 'admin' | 'ops' | 'support' | 'auditor';
export type Permission =
  | 'vendor.read'
  | 'vendor.write'
  | 'retailer.read'
  | 'retailer.write'
  | 'iam.read'
  | 'iam.write'
  | 'audit.read'
  | 'support.verify'
  | 'support.read'
  | 'money.operate';

export type Me = {
  id: string;
  email: string;
  displayName: string | null;
  roles: Role[];
  permissions: Permission[];
};

export type ApprovalKind = 'role_grant' | 'vendor_approve_claim';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type RoleGrantPayload = { targetAdminUserId: string; role: Role };
export type VendorClaimPayload = { vendorId: string; phone: string; category: string | null };

export type Approval = {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  payload: RoleGrantPayload | VendorClaimPayload;
  makerAdminUserId: string;
  makerEmail: string;
  checkerAdminUserId: string | null;
  checkerEmail: string | null;
  reason: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};

export type ApprovalOutcome =
  | { kind: 'role_grant' }
  | { kind: 'vendor_approve_claim'; publicCode: string; displayName: string | null };

export type AdminSummary = {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'suspended';
  provisioningSource: 'config' | 'admin';
  lastSignedInAt: string | null;
  roles: Role[];
};

export type RoleGrant = {
  role: Role;
  granted: boolean;
  grantedByAdminUserId: string | null;
  source: 'config' | 'admin';
  reason: string | null;
  recordedAt: string;
};

export type VendorStatus = 'observed' | 'claimed' | 'suspended';
export type VendorSummary = {
  id: string;
  displayName: string;
  bankCode: string;
  accountNumberMasked: string;
  status: VendorStatus;
  category: string | null;
  categorySource: 'observed' | 'claimed' | 'ops';
  publicCode: string | null;
  promotedHouseholdCount: number;
  promotedAt: string;
  claimedAt: string | null;
};

export type ClaimAttempt = {
  id: string;
  vendorId: string;
  phone: string;
  status: 'pending' | 'verified' | 'expired' | 'rejected';
  ownershipProof: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
  vendor?: VendorSummary | null;
};

export type ConsentPurpose = 'service_terms' | 'lender_introduction';
export type ConsentRow = {
  id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  termsVersion: string | null;
  source: string;
  recordedAt: string;
};

export type RetailerStatus = 'applied' | 'kyb_pending' | 'approved' | 'suspended';
export type Retailer = {
  id: string;
  businessName: string;
  anchorBusinessCustomerId: string | null;
  payoutBankCode: string;
  payoutAccountNumber: string;
  onboardingStatus: RetailerStatus;
  ownerUserId: string | null;
  contactPhone: string | null;
  approvedAt: string | null;
  createdAt: string;
};

/** Copied from packages/types/src/categories.ts — the closed vocabulary both sides validate. */
export const SPEND_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'transport', label: 'Transport' },
  { value: 'food', label: 'Food & market' },
  { value: 'school', label: 'School' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'airtime_data', label: 'Airtime & data' },
  { value: 'electricity', label: 'Electricity' },
  { value: 'cable_tv', label: 'Cable TV' },
  { value: 'health', label: 'Health & pharmacy' },
  { value: 'repairs', label: 'Repairs & maintenance' },
  { value: 'supplies', label: 'Business supplies' },
  { value: 'other', label: 'Other' },
];

export const ROLES: readonly Role[] = ['owner', 'admin', 'ops', 'support', 'auditor'];
