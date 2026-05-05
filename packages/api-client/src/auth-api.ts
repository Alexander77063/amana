import type { LoginResponse, OtpPurpose, User } from '@amana/types';
import { ApiError } from './errors';

export type RawFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type RequestOtpInput = { phone: string; purpose: OtpPurpose };
export type RequestOtpResult = { challengeId: string; expiresAt: string };

export type VerifyOtpInput = {
  phone: string;
  code: string;
  pairingCode?: string;
  nin?: string;
  bvn?: string;
};

export type RefreshInput = {
  refreshToken: string;
  userId: string;
  role: 'principal' | 'agent';
};
export type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

async function postJson<T>(
  fetchImpl: RawFetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  const text = await res.text();
  const parsed: unknown = text ? safeJsonParse(text) : null;
  if (!res.ok) throw ApiError.fromResponse(res.status, parsed);
  return parsed as T;
}

async function getJson<T>(
  fetchImpl: RawFetch,
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  const text = await res.text();
  const parsed: unknown = text ? safeJsonParse(text) : null;
  if (!res.ok) throw ApiError.fromResponse(res.status, parsed);
  return parsed as T;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export class AuthApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: RawFetch,
  ) {}

  requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
    return postJson<RequestOtpResult>(this.fetchImpl, `${this.baseUrl}/auth/otp/request`, input);
  }

  verifyOtp(input: VerifyOtpInput): Promise<LoginResponse> {
    return postJson<LoginResponse>(this.fetchImpl, `${this.baseUrl}/auth/otp/verify`, input);
  }

  refresh(input: RefreshInput): Promise<RefreshResult> {
    return postJson<RefreshResult>(this.fetchImpl, `${this.baseUrl}/auth/refresh`, input);
  }

  logout(accessToken: string): Promise<{ revoked: true }> {
    return postJson<{ revoked: true }>(
      this.fetchImpl,
      `${this.baseUrl}/auth/logout`,
      {},
      { authorization: `Bearer ${accessToken}` },
    );
  }

  me(accessToken: string): Promise<User> {
    return getJson<User>(this.fetchImpl, `${this.baseUrl}/me`, {
      authorization: `Bearer ${accessToken}`,
    });
  }
}
