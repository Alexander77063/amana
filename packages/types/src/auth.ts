export type Role = 'principal' | 'agent';
export type KycTier = '1' | '2' | '3';
export type UserStatus = 'active' | 'suspended';
export type OtpPurpose = 'login' | 'pair';

export type User = {
  id: string;
  role: Role;
  phone: string;
  kycTier: KycTier;
  status?: UserStatus;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export type LoginResponse = IssuedTokens & { user: User };
