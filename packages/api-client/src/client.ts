import type { ZodType } from 'zod';
import { AuthApi } from './auth-api';
import { BumpApi } from './bump-api';
import { DeviceApi } from './device-api';
import { ApiError } from './errors';
import { HouseholdApi } from './household-api';
import { MeApi } from './me-api';
import { MediaApi } from './media-api';
import { NotificationApi } from './notification-api';
import { PairingApi } from './pairing-api';
import { PreferenceApi } from './preference-api';
import { SubWalletApi } from './sub-wallet-api';
import type { StoredAuth, TokenStore } from './token-store';
import { TransactionApi } from './transaction-api';
import { VendorApi } from './vendor-api';

export interface ClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** When omitted, the client cannot persist auth and `request()` won't bearer + refresh. */
  tokenStore?: TokenStore;
}

export type RequestInit2 = Omit<RequestInit, 'body' | 'headers'> & {
  headers?: Record<string, string>;
  jsonBody?: unknown;
};

export class AmanaApiClient {
  public readonly baseUrl: string;
  public readonly auth: AuthApi;
  public readonly bump: BumpApi;
  public readonly device: DeviceApi;
  public readonly household: HouseholdApi;
  public readonly media: MediaApi;
  public readonly me: MeApi;
  public readonly notification: NotificationApi;
  public readonly preference: PreferenceApi;
  public readonly subWallet: SubWalletApi;
  public readonly pairing: PairingApi;
  public readonly transaction: TransactionApi;
  public readonly vendor: VendorApi;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenStore?: TokenStore;
  private inflightRefresh: Promise<StoredAuth> | null = null;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.tokenStore = config.tokenStore;
    this.auth = new AuthApi(this.baseUrl, this.fetchImpl);
    this.household = new HouseholdApi(this);
    this.subWallet = new SubWalletApi(this);
    this.pairing = new PairingApi(this);
    this.bump = new BumpApi(this);
    this.notification = new NotificationApi(this);
    this.device = new DeviceApi(this);
    this.preference = new PreferenceApi(this);
    this.transaction = new TransactionApi(this);
    this.vendor = new VendorApi(this);
    this.media = new MediaApi(this);
    this.me = new MeApi(this);
  }

  async health(): Promise<{ status: 'ok'; version: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`);
    if (!res.ok) throw ApiError.fromResponse(res.status, await safeBody(res));
    return (await res.json()) as { status: 'ok'; version: string };
  }

  /**
   * Authenticated JSON request. Reads the access token from the store,
   * adds a bearer header, retries once on 401 after rotating tokens via
   * `/auth/refresh` (single-flight). Throws ApiError on any other failure.
   */
  async request<T>(path: string, init: RequestInit2 = {}, schema?: ZodType<T>): Promise<T> {
    if (!this.tokenStore) throw new Error('AmanaApiClient.request requires a tokenStore');
    return this.requestOnce<T>(path, init, false, schema);
  }

  private async requestOnce<T>(path: string, init: RequestInit2, retried: boolean, schema?: ZodType<T>): Promise<T> {
    const stored = await this.tokenStore?.read();
    if (!stored) throw new ApiError('not_authed', 401, 'not_authed', null);

    const headers: Record<string, string> = {
      ...(init.headers ?? {}),
      authorization: `Bearer ${stored.tokens.accessToken}`,
    };
    let body: BodyInit | undefined;
    if (init.jsonBody !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.jsonBody);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, body });
    } catch (cause) {
      throw ApiError.network(cause);
    }

    if (res.status === 401 && !retried) {
      await this.refreshNow();
      return this.requestOnce<T>(path, init, true, schema);
    }
    if (!res.ok) throw ApiError.fromResponse(res.status, await safeBody(res));
    const parsed = await res.json();
    if (schema) return schema.parse(parsed) as T;
    return parsed as T;
  }

  /** Single-flight refresh: concurrent 401s fan in to one /auth/refresh call. */
  private async refreshNow(): Promise<StoredAuth> {
    if (!this.tokenStore) throw new ApiError('not_authed', 401, 'not_authed', null);
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = (async () => {
      const current = await this.tokenStore?.read();
      if (!current) throw new ApiError('not_authed', 401, 'not_authed', null);
      const r = await this.auth.refresh({
        refreshToken: current.tokens.refreshToken,
        userId: current.user.id,
        role: current.user.role,
      });
      const next: StoredAuth = {
        user: current.user,
        tokens: {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          accessExpiresAt: r.accessExpiresAt,
          refreshExpiresAt: r.refreshExpiresAt,
        },
      };
      await this.tokenStore?.write(next);
      return next;
    })();
    try {
      return await this.inflightRefresh;
    } finally {
      this.inflightRefresh = null;
    }
  }
}

async function safeBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
