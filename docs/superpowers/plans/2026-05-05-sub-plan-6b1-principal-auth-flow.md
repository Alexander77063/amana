# Sub-plan 6b-1 — Principal Mobile App: shell + auth flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Principal mobile app shell on Expo/React Native that authenticates against the v0.0.6a-auth backend (phone OTP → JWT) and persists the session across app restarts. After this plan, a principal can install the app, sign up via phone+NIN+BVN, log in, see a placeholder home, and log out — with tokens auto-refreshed when the access JWT expires.

**Architecture:** Three-layer split. (1) `@amana/api-client` — pure-TS HTTP client extended with typed `requestOtp / verifyOtp / refresh / logout / me` methods, an `ApiError` class, and a single-flight 401-triggered auto-refresh wrapper. Tested with vitest against a mocked `fetch`. (2) `@amana/principal` — Expo SDK 51 + React Native 0.74.5 app. Zustand auth store rehydrates tokens from `expo-secure-store` on boot, exposes `requestOtp / verifyOtp / logout` actions. React Navigation native-stack routes between an Auth stack (Phone → Verify) and a Main stack (Home placeholder) gated on the store's `status`. (3) `@amana/types` — shared types for `Role`, `KycTier`, `User`, `IssuedTokens` so backend and mobile stay in sync at the type level.

**Tech Stack:** TypeScript strict + Expo SDK 51 + React Native 0.74.5 + React Navigation v7 (`@react-navigation/native` + `@react-navigation/native-stack`) + Zustand 5 + react-hook-form + zod + `expo-secure-store` for token storage + `expo-notifications` (registered but not yet wired). Vitest for `@amana/api-client` tests; mobile screens are typecheck-validated only (per existing `principal/package.json` `test` script convention — we keep it that way for this slice).

---

## File structure produced by this plan

**New / modified in `packages/types`:**
- `src/auth.ts` — `Role`, `KycTier`, `User`, `IssuedTokens`, `OtpPurpose` (re-shaped from the backend types but consumable from RN)
- `src/index.ts` — re-export

**New / modified in `packages/api-client`:**
- `src/errors.ts` — `ApiError` class
- `src/auth-api.ts` — typed methods: `requestOtp`, `verifyOtp`, `refresh`, `logout`, `me`
- `src/token-store.ts` — `TokenStore` interface (pluggable; mobile injects `expo-secure-store` impl)
- `src/client.ts` — extend `AmanaApiClient` with `request()` (bearer + 401 auto-refresh) and `auth: AuthApi` accessor
- `src/index.ts` — re-export
- `tests/auth-api.test.ts`, `tests/client.test.ts`, `tests/errors.test.ts` — vitest

**New in `apps/principal/src`:**
- `lib/api.ts` — singleton `AmanaApiClient` configured for the app
- `lib/secure-token-store.ts` — `TokenStore` impl backed by `expo-secure-store`
- `state/auth.store.ts` — Zustand auth store
- `nav/RootNavigator.tsx` — auth/main stack switcher
- `nav/AuthStack.tsx` — Phone → Verify
- `nav/MainStack.tsx` — Home (placeholder)
- `screens/SplashScreen.tsx` — booting state
- `screens/PhoneScreen.tsx` — phone entry → request OTP
- `screens/VerifyScreen.tsx` — OTP entry → verify (+ NIN/BVN for new principals)
- `screens/HomeScreen.tsx` — placeholder + logout button
- `App.tsx` — replaced (mounts the navigator + bootstraps the auth store)

---

## Phase A — workspace setup (Tasks 1-3)

### Task 1 — Install mobile + shared deps

**Files:**
- Modify: `apps/principal/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install runtime deps**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal add \
  @react-navigation/native@^7.0.0 \
  @react-navigation/native-stack@^7.0.0 \
  react-native-screens \
  react-native-safe-area-context \
  zustand \
  expo-secure-store \
  expo-notifications \
  react-hook-form \
  @hookform/resolvers \
  zod
```

- [ ] **Step 2: Install vitest in api-client (test-only)**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client add -D vitest
```

- [ ] **Step 3: Update `apps/principal/package.json` `test` script**

Replace:
```json
"test": "echo 'mobile tests land in Sub-plan 6' && exit 0"
```
with:
```json
"test": "echo 'principal: typecheck-only; logic-layer tests live in @amana/api-client' && pnpm typecheck"
```

- [ ] **Step 4: Update `packages/api-client/package.json` to add a `test` script**

```json
"test": "vitest run"
```

- [ ] **Step 5: Smoke install + typecheck**

```bash
cd "C:/Users/alex_/amana"
pnpm install
pnpm --filter @amana/principal typecheck
pnpm --filter @amana/api-client typecheck
```

Both commands must exit 0.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/package.json packages/api-client/package.json pnpm-lock.yaml
git -C "C:/Users/alex_/amana" commit -m "chore(mobile): add react-navigation, zustand, expo-secure-store, react-hook-form, zod + vitest in api-client"
```

---

### Task 2 — Shared auth types in `@amana/types`

**Files:**
- Create: `packages/types/src/auth.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Auth types**

```ts
// packages/types/src/auth.ts
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
```

- [ ] **Step 2: Re-export**

Replace `packages/types/src/index.ts` with:

```ts
export * from './auth';
```

(Drop the `__amanaTypesPackageBootstrapped` sentinel — its job is done.)

- [ ] **Step 3: Build types package**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/types build
```

Expected: `dist/index.js` + `dist/index.d.ts` exist with the new exports.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/types/src
git -C "C:/Users/alex_/amana" commit -m "feat(types): Role, KycTier, User, IssuedTokens, LoginResponse"
```

---

### Task 3 — Vitest config for `@amana/api-client`

**Files:**
- Create: `packages/api-client/vitest.config.ts`

- [ ] **Step 1: Config**

```ts
// packages/api-client/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Verify**

```bash
cd "C:/Users/alex_/amana/packages/api-client"
pnpm exec vitest run --reporter=verbose
```

Expected: "No test files found" (no error). The config loads cleanly.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/vitest.config.ts
git -C "C:/Users/alex_/amana" commit -m "chore(api-client): vitest config (node env, tests/**/*.test.ts)"
```

---

## Phase B — `@amana/api-client` extension (Tasks 4-7)

### Task 4 — `ApiError` class

**Files:**
- Create: `packages/api-client/src/errors.ts`
- Create: `packages/api-client/tests/errors.test.ts`

- [ ] **Step 1: Errors module**

```ts
// packages/api-client/src/errors.ts
/**
 * Thrown for any non-2xx HTTP response or transport-layer failure.
 * `code` is the parsed `error` field from a JSON body when available,
 * falling back to `'http_<status>'` or `'network_error'`.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly body: unknown;

  constructor(message: string, status: number, code: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  static fromResponse(status: number, body: unknown): ApiError {
    const code =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `http_${status}`;
    return new ApiError(`${code} (${status})`, status, code, body);
  }

  static network(cause: unknown): ApiError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ApiError(`network_error: ${msg}`, 0, 'network_error', { cause: msg });
  }
}
```

- [ ] **Step 2: Test**

```ts
// packages/api-client/tests/errors.test.ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';

describe('ApiError', () => {
  it('fromResponse extracts code from {error} body', () => {
    const e = ApiError.fromResponse(401, { error: 'wrong_code' });
    expect(e.status).toBe(401);
    expect(e.code).toBe('wrong_code');
    expect(e.message).toBe('wrong_code (401)');
    expect(e.body).toEqual({ error: 'wrong_code' });
  });

  it('fromResponse falls back to http_<status> when no error field', () => {
    const e = ApiError.fromResponse(500, { unexpected: true });
    expect(e.code).toBe('http_500');
  });

  it('fromResponse handles non-object body', () => {
    const e = ApiError.fromResponse(404, 'not found');
    expect(e.code).toBe('http_404');
  });

  it('network wraps an underlying cause', () => {
    const cause = new TypeError('fetch failed');
    const e = ApiError.network(cause);
    expect(e.status).toBe(0);
    expect(e.code).toBe('network_error');
    expect(e.message).toContain('fetch failed');
  });

  it('is a real Error subclass', () => {
    const e = ApiError.fromResponse(401, { error: 'x' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ApiError');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client test
git -C "C:/Users/alex_/amana" add packages/api-client/src/errors.ts packages/api-client/tests/errors.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): ApiError class (status, code, body, fromResponse, network)"
```

---

### Task 5 — `TokenStore` interface

**Files:**
- Create: `packages/api-client/src/token-store.ts`

This is the contract; mobile injects an `expo-secure-store`-backed implementation in Task 9.

- [ ] **Step 1: Interface**

```ts
// packages/api-client/src/token-store.ts
import type { IssuedTokens, User } from '@amana/types';

/** Persistent + revocable storage for the auth state. Implementation is platform-specific. */
export interface TokenStore {
  read(): Promise<StoredAuth | null>;
  write(auth: StoredAuth): Promise<void>;
  clear(): Promise<void>;
}

/**
 * What we persist across app restarts. The `userId+role` shape is required
 * to call `/auth/refresh` (which is unauthenticated against the access JWT
 * by design — see Sub-plan 6a, T16).
 */
export type StoredAuth = {
  tokens: IssuedTokens;
  user: User;
};

/** In-memory impl — useful for tests + the auto-refresh single-flight cache. */
export function createInMemoryTokenStore(): TokenStore {
  let state: StoredAuth | null = null;
  return {
    async read() {
      return state;
    },
    async write(auth) {
      state = auth;
    },
    async clear() {
      state = null;
    },
  };
}
```

- [ ] **Step 2: Commit (test arrives in T7 alongside the auto-refresh wrapper)**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/src/token-store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): TokenStore interface + createInMemoryTokenStore"
```

---

### Task 6 — `AuthApi` typed methods

**Files:**
- Create: `packages/api-client/src/auth-api.ts`
- Create: `packages/api-client/tests/auth-api.test.ts`

- [ ] **Step 1: Auth API methods (raw — no token bearing yet, that's the client wrapper in T7)**

```ts
// packages/api-client/src/auth-api.ts
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

async function postJson<T>(fetchImpl: RawFetch, url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
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

async function getJson<T>(fetchImpl: RawFetch, url: string, headers: Record<string, string> = {}): Promise<T> {
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
```

- [ ] **Step 2: Test**

```ts
// packages/api-client/tests/auth-api.test.ts
import { describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../src/auth-api';
import { ApiError } from '../src/errors';

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('AuthApi.requestOtp', () => {
  it('POSTs to /auth/otp/request and returns the parsed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ challengeId: 'c1', expiresAt: '2026-05-05T00:05:00Z' }));
    const api = new AuthApi('https://api.x', fetchImpl);
    const r = await api.requestOtp({ phone: '+2348012345678', purpose: 'login' });
    expect(r.challengeId).toBe('c1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x/auth/otp/request',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
  });

  it('throws ApiError on 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ error: 'invalid_phone' }, 400));
    const api = new AuthApi('https://api.x', fetchImpl);
    await expect(api.requestOtp({ phone: 'bad', purpose: 'login' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'invalid_phone',
    });
  });
});

describe('AuthApi.verifyOtp', () => {
  it('returns LoginResponse on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        accessToken: 'a.b.c',
        refreshToken: 'r1',
        accessExpiresAt: '2026-05-05T00:05:00Z',
        refreshExpiresAt: '2026-06-04T00:00:00Z',
        user: { id: 'u1', role: 'principal', phone: '+234801', kycTier: '1' },
      }),
    );
    const api = new AuthApi('https://api.x', fetchImpl);
    const r = await api.verifyOtp({ phone: '+234801', code: '123456', nin: '1', bvn: '2' });
    expect(r.user.role).toBe('principal');
    expect(r.accessToken).toBe('a.b.c');
  });
});

describe('AuthApi.me', () => {
  it('GETs /me with bearer header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({ id: 'u1', role: 'principal', phone: '+234801', kycTier: '1', status: 'active' }),
    );
    const api = new AuthApi('https://api.x', fetchImpl);
    const u = await api.me('access-token');
    expect(u.id).toBe('u1');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.x/me', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
    }));
  });

  it('throws ApiError on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ error: 'session_revoked' }, 401));
    const api = new AuthApi('https://api.x', fetchImpl);
    await expect(api.me('stale')).rejects.toMatchObject({ status: 401, code: 'session_revoked' });
  });
});

describe('AuthApi network errors', () => {
  it('wraps fetch failure in ApiError(network_error)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const api = new AuthApi('https://api.x', fetchImpl);
    await expect(api.requestOtp({ phone: '+234', purpose: 'login' })).rejects.toMatchObject({
      code: 'network_error',
      status: 0,
    });
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client test
git -C "C:/Users/alex_/amana" add packages/api-client/src/auth-api.ts packages/api-client/tests/auth-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): AuthApi (requestOtp/verifyOtp/refresh/logout/me)"
```

---

### Task 7 — `AmanaApiClient` with bearer + 401 auto-refresh

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`
- Create: `packages/api-client/tests/client.test.ts`

- [ ] **Step 1: Client**

```ts
// packages/api-client/src/client.ts
import { AuthApi } from './auth-api';
import { ApiError } from './errors';
import type { StoredAuth, TokenStore } from './token-store';

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
  private readonly fetchImpl: typeof fetch;
  private readonly tokenStore?: TokenStore;
  private inflightRefresh: Promise<StoredAuth> | null = null;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.tokenStore = config.tokenStore;
    this.auth = new AuthApi(this.baseUrl, this.fetchImpl);
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
  async request<T>(path: string, init: RequestInit2 = {}): Promise<T> {
    if (!this.tokenStore) throw new Error('AmanaApiClient.request requires a tokenStore');
    return this.requestOnce<T>(path, init, /* retried */ false);
  }

  private async requestOnce<T>(path: string, init: RequestInit2, retried: boolean): Promise<T> {
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
      return this.requestOnce<T>(path, init, true);
    }
    if (!res.ok) throw ApiError.fromResponse(res.status, await safeBody(res));
    return (await res.json()) as T;
  }

  /** Single-flight refresh: concurrent 401s fan in to one /auth/refresh call. */
  private async refreshNow(): Promise<StoredAuth> {
    if (!this.tokenStore) throw new ApiError('not_authed', 401, 'not_authed', null);
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = (async () => {
      const current = await this.tokenStore!.read();
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
      await this.tokenStore!.write(next);
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
```

- [ ] **Step 2: Re-export**

`packages/api-client/src/index.ts`:

```ts
export { AmanaApiClient, type ClientConfig, type RequestInit2 } from './client';
export { AuthApi } from './auth-api';
export type {
  RequestOtpInput,
  RequestOtpResult,
  VerifyOtpInput,
  RefreshInput,
  RefreshResult,
} from './auth-api';
export { ApiError } from './errors';
export {
  type TokenStore,
  type StoredAuth,
  createInMemoryTokenStore,
} from './token-store';
```

- [ ] **Step 3: Test**

```ts
// packages/api-client/tests/client.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmanaApiClient } from '../src/client';
import { createInMemoryTokenStore, type TokenStore } from '../src/token-store';
import type { StoredAuth } from '../src/token-store';

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const seedAuth = async (store: TokenStore, accessToken = 'A1', refreshToken = 'R1'): Promise<StoredAuth> => {
  const auth: StoredAuth = {
    tokens: {
      accessToken,
      refreshToken,
      accessExpiresAt: '2026-05-05T00:05:00Z',
      refreshExpiresAt: '2026-06-04T00:00:00Z',
    },
    user: { id: 'u1', role: 'principal', phone: '+234801', kycTier: '1' },
  };
  await store.write(auth);
  return auth;
};

describe('AmanaApiClient.health', () => {
  it('returns parsed body on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ status: 'ok', version: '0.1.0' }));
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl });
    expect(await client.health()).toEqual({ status: 'ok', version: '0.1.0' });
  });
});

describe('AmanaApiClient.request', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let tokenStore: TokenStore;

  beforeEach(() => {
    fetchImpl = vi.fn();
    tokenStore = createInMemoryTokenStore();
  });

  it('adds bearer header from token store', async () => {
    await seedAuth(tokenStore, 'A1');
    fetchImpl.mockResolvedValueOnce(ok({ ok: true }));
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    await client.request('/me/notifications');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x/me/notifications',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer A1' }),
      }),
    );
  });

  it('on 401 refreshes once + retries with new bearer', async () => {
    await seedAuth(tokenStore, 'A1', 'R1');
    fetchImpl
      .mockResolvedValueOnce(ok({ error: 'session_expired' }, 401)) // initial protected call
      .mockResolvedValueOnce(
        ok({                                                          // /auth/refresh
          accessToken: 'A2',
          refreshToken: 'R2',
          accessExpiresAt: '2026-05-05T00:10:00Z',
          refreshExpiresAt: '2026-06-04T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(ok({ ok: true }));                       // retried protected call

    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    const r = await client.request<{ ok: boolean }>('/me/notifications');
    expect(r.ok).toBe(true);
    const stored = await tokenStore.read();
    expect(stored?.tokens.accessToken).toBe('A2');

    const calls = fetchImpl.mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[2][1].headers.authorization).toBe('Bearer A2');
  });

  it('only refreshes once even on concurrent 401s (single-flight)', async () => {
    await seedAuth(tokenStore, 'A1', 'R1');
    let refreshCalls = 0;
    fetchImpl.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return ok({
          accessToken: `A2_${refreshCalls}`,
          refreshToken: `R2_${refreshCalls}`,
          accessExpiresAt: '2026-05-05T00:10:00Z',
          refreshExpiresAt: '2026-06-04T00:00:00Z',
        });
      }
      // Protected call: 401 first, then 200 (after refresh).
      const stored = await tokenStore.read();
      if (stored?.tokens.accessToken === 'A1') return ok({ error: 'session_expired' }, 401);
      return ok({ ok: true });
    });
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    const [r1, r2] = await Promise.all([
      client.request<{ ok: boolean }>('/p/1'),
      client.request<{ ok: boolean }>('/p/2'),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('throws not_authed when no token in store', async () => {
    const client = new AmanaApiClient({
      baseUrl: 'https://api.x',
      fetchImpl,
      tokenStore: createInMemoryTokenStore(),
    });
    await expect(client.request('/anything')).rejects.toMatchObject({ status: 401, code: 'not_authed' });
  });

  it('throws on second 401 (refresh did not unblock)', async () => {
    await seedAuth(tokenStore, 'A1', 'R1');
    fetchImpl
      .mockResolvedValueOnce(ok({ error: 'session_revoked' }, 401))
      .mockResolvedValueOnce(
        ok({
          accessToken: 'A2',
          refreshToken: 'R2',
          accessExpiresAt: '2026-05-05T00:10:00Z',
          refreshExpiresAt: '2026-06-04T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(ok({ error: 'session_revoked' }, 401));

    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    await expect(client.request('/p')).rejects.toMatchObject({ status: 401, code: 'session_revoked' });
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client test
pnpm --filter @amana/api-client typecheck
git -C "C:/Users/alex_/amana" add packages/api-client/src packages/api-client/tests/client.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): bearer + single-flight 401 auto-refresh on AmanaApiClient.request"
```

---

## Phase C — auth state + storage in `@amana/principal` (Tasks 8-10)

### Task 8 — `SecureTokenStore` (expo-secure-store impl)

**Files:**
- Create: `apps/principal/src/lib/secure-token-store.ts`

- [ ] **Step 1: Implementation**

```ts
// apps/principal/src/lib/secure-token-store.ts
import * as SecureStore from 'expo-secure-store';
import type { StoredAuth, TokenStore } from '@amana/api-client';

const KEY = 'amana.auth.v1';

export const secureTokenStore: TokenStore = {
  async read() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      // Storage was corrupted somehow; treat as logged out.
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
  },
  async write(auth) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(auth));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};
```

- [ ] **Step 2: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/lib/secure-token-store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): expo-secure-store-backed TokenStore"
```

---

### Task 9 — Singleton `AmanaApiClient` for the app

**Files:**
- Create: `apps/principal/src/lib/api.ts`

- [ ] **Step 1: Wire the client**

```ts
// apps/principal/src/lib/api.ts
import { AmanaApiClient } from '@amana/api-client';
import { secureTokenStore } from './secure-token-store';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

export const api = new AmanaApiClient({
  baseUrl: BACKEND_URL,
  tokenStore: secureTokenStore,
});
```

- [ ] **Step 2: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/lib/api.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): AmanaApiClient singleton wired to secureTokenStore"
```

---

### Task 10 — Zustand auth store

**Files:**
- Create: `apps/principal/src/state/auth.store.ts`

- [ ] **Step 1: Store**

```ts
// apps/principal/src/state/auth.store.ts
import { create } from 'zustand';
import type { LoginResponse, User } from '@amana/types';
import type { StoredAuth } from '@amana/api-client';
import { ApiError } from '@amana/api-client';
import { api } from '../lib/api';
import { secureTokenStore } from '../lib/secure-token-store';

export type AuthStatus = 'booting' | 'logged_out' | 'logged_in';

export type AuthState = {
  status: AuthStatus;
  user: User | null;
  /** Phone we're verifying against — set by requestOtp, used by verifyOtp. */
  pendingPhone: string | null;
  /** Most recent error code (e.g. 'wrong_code', 'too_many_attempts'). null when clean. */
  errorCode: string | null;
  /** True while a network call is inflight. */
  busy: boolean;

  bootstrap(): Promise<void>;
  requestOtp(phone: string): Promise<void>;
  verifyOtp(input: { code: string; nin?: string; bvn?: string }): Promise<void>;
  logout(): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'booting',
  user: null,
  pendingPhone: null,
  errorCode: null,
  busy: false,

  async bootstrap() {
    const stored = await secureTokenStore.read();
    if (!stored) {
      set({ status: 'logged_out', user: null });
      return;
    }
    // Validate the persisted session. If `/me` 401s and refresh fails, the store auto-clears.
    try {
      const me = await api.request<User>('/me');
      set({ status: 'logged_in', user: me });
    } catch {
      await secureTokenStore.clear();
      set({ status: 'logged_out', user: null });
    }
  },

  async requestOtp(phone) {
    set({ busy: true, errorCode: null });
    try {
      await api.auth.requestOtp({ phone, purpose: 'login' });
      set({ pendingPhone: phone, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async verifyOtp({ code, nin, bvn }) {
    const phone = get().pendingPhone;
    if (!phone) throw new Error('verifyOtp called without pendingPhone — call requestOtp first');
    set({ busy: true, errorCode: null });
    try {
      const r: LoginResponse = await api.auth.verifyOtp({ phone, code, nin, bvn });
      const stored: StoredAuth = {
        tokens: {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          accessExpiresAt: r.accessExpiresAt,
          refreshExpiresAt: r.refreshExpiresAt,
        },
        user: r.user,
      };
      await secureTokenStore.write(stored);
      set({ status: 'logged_in', user: r.user, pendingPhone: null, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async logout() {
    set({ busy: true });
    try {
      try {
        const stored = await secureTokenStore.read();
        if (stored) await api.auth.logout(stored.tokens.accessToken);
      } catch {
        // Best-effort — even if revoke fails, we clear locally.
      }
      await secureTokenStore.clear();
      set({ status: 'logged_out', user: null, pendingPhone: null, busy: false, errorCode: null });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },
}));
```

- [ ] **Step 2: Typecheck**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/state/auth.store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): Zustand auth store (bootstrap/requestOtp/verifyOtp/logout)"
```

---

## Phase D — navigation shell (Tasks 11-12)

### Task 11 — Splash + Home placeholder + AuthStack/MainStack

**Files:**
- Create: `apps/principal/src/screens/SplashScreen.tsx`
- Create: `apps/principal/src/screens/HomeScreen.tsx`
- Create: `apps/principal/src/nav/AuthStack.tsx`
- Create: `apps/principal/src/nav/MainStack.tsx`

- [ ] **Step 1: SplashScreen**

```tsx
// apps/principal/src/screens/SplashScreen.tsx
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export function SplashScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Amana</Text>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  title: { fontSize: 32, fontWeight: '600' },
});
```

- [ ] **Step 2: HomeScreen (placeholder)**

```tsx
// apps/principal/src/screens/HomeScreen.tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../state/auth.store';

export function HomeScreen(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const busy = useAuthStore((s) => s.busy);

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Welcome, principal</Text>
      <Text style={styles.muted}>Phone: {user?.phone ?? '(unknown)'}</Text>
      <Text style={styles.muted}>KYC tier: {user?.kycTier ?? '?'}</Text>
      <Text style={styles.muted}>User id: {user?.id ?? '(none)'}</Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}
        disabled={busy}
        onPress={() => {
          void logout();
        }}
      >
        <Text style={styles.buttonText}>{busy ? 'Logging out…' : 'Log out'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  greeting: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666', fontSize: 14 },
  button: {
    marginTop: 24,
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 3: MainStack**

```tsx
// apps/principal/src/nav/MainStack.tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';

export type MainStackParamList = {
  Home: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Amana' }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 4: AuthStack (skeleton — screens added in T13/T14)**

```tsx
// apps/principal/src/nav/AuthStack.tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PhoneScreen } from '../screens/PhoneScreen';
import { VerifyScreen } from '../screens/VerifyScreen';

export type AuthStackParamList = {
  Phone: undefined;
  Verify: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Phone" component={PhoneScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen name="Verify" component={VerifyScreen} options={{ title: 'Verify' }} />
    </Stack.Navigator>
  );
}
```

(This will fail typecheck until Tasks 13 + 14 add `PhoneScreen` and `VerifyScreen`. We commit the skeleton anyway and finish in the next two tasks. To keep CI green at every commit, instead create stub screens here and replace them in T13/T14.)

To keep typecheck green now, also create stub screen files:

```tsx
// apps/principal/src/screens/PhoneScreen.tsx (STUB — replaced in T13)
import { Text, View } from 'react-native';
export function PhoneScreen(): JSX.Element {
  return <View><Text>Phone (stub)</Text></View>;
}
```

```tsx
// apps/principal/src/screens/VerifyScreen.tsx (STUB — replaced in T14)
import { Text, View } from 'react-native';
export function VerifyScreen(): JSX.Element {
  return <View><Text>Verify (stub)</Text></View>;
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens apps/principal/src/nav
git -C "C:/Users/alex_/amana" commit -m "feat(principal): MainStack + AuthStack + Splash/Home/Phone/Verify scaffolding"
```

---

### Task 12 — `RootNavigator` + bootstrap-aware switch

**Files:**
- Create: `apps/principal/src/nav/RootNavigator.tsx`
- Modify: `apps/principal/App.tsx`

- [ ] **Step 1: RootNavigator**

```tsx
// apps/principal/src/nav/RootNavigator.tsx
import { NavigationContainer } from '@react-navigation/native';
import { useEffect } from 'react';
import { useAuthStore } from '../state/auth.store';
import { SplashScreen } from '../screens/SplashScreen';
import { AuthStack } from './AuthStack';
import { MainStack } from './MainStack';

export function RootNavigator(): JSX.Element {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'booting') return <SplashScreen />;

  return (
    <NavigationContainer>
      {status === 'logged_in' ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
```

- [ ] **Step 2: Replace App.tsx**

```tsx
// apps/principal/App.tsx
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/nav/RootNavigator';

export default function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 3: Delete the old HealthCheck (no longer the entry)**

```bash
git -C "C:/Users/alex_/amana" rm apps/principal/src/screens/HealthCheck.tsx
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/nav/RootNavigator.tsx apps/principal/App.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): RootNavigator switches AuthStack/MainStack on auth.status"
```

---

## Phase E — auth screens (Tasks 13-14)

### Task 13 — `PhoneScreen` (request OTP)

**Files:**
- Replace: `apps/principal/src/screens/PhoneScreen.tsx`

- [ ] **Step 1: Screen**

```tsx
// apps/principal/src/screens/PhoneScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AuthStackParamList } from '../nav/AuthStack';
import { useAuthStore } from '../state/auth.store';

type Props = NativeStackScreenProps<AuthStackParamList, 'Phone'>;

const schema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/, 'Use international format (+234…)'),
});
type FormValues = z.infer<typeof schema>;

export function PhoneScreen({ navigation }: Props): JSX.Element {
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const busy = useAuthStore((s) => s.busy);
  const errorCode = useAuthStore((s) => s.errorCode);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '+234' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await requestOtp(values.phone);
      navigation.navigate('Verify');
    } catch {
      // errorCode already set on store; UI re-renders.
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Enter your phone</Text>
      <Text style={styles.muted}>
        We&apos;ll send a 6-digit code to verify it&apos;s you.
      </Text>

      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <View>
            <TextInput
              autoFocus
              keyboardType="phone-pad"
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="+2348012345678"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      {errorCode && <Text style={styles.err}>Server: {errorCode}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={busy || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          (busy || formState.isSubmitting) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>{busy ? 'Sending…' : 'Send code'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 2: Typecheck**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/PhoneScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): PhoneScreen — phone entry → request OTP → navigate Verify"
```

---

### Task 14 — `VerifyScreen` (OTP + optional NIN/BVN)

**Files:**
- Replace: `apps/principal/src/screens/VerifyScreen.tsx`

- [ ] **Step 1: Screen**

```tsx
// apps/principal/src/screens/VerifyScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AuthStackParamList } from '../nav/AuthStack';
import { useAuthStore } from '../state/auth.store';

type Props = NativeStackScreenProps<AuthStackParamList, 'Verify'>;

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Six digits'),
  nin: z
    .string()
    .regex(/^\d{11}$/, 'Eleven digits')
    .optional()
    .or(z.literal('')),
  bvn: z
    .string()
    .regex(/^\d{11}$/, 'Eleven digits')
    .optional()
    .or(z.literal('')),
});
type FormValues = z.infer<typeof schema>;

/**
 * Two flows:
 *  - Returning user: enter the code, server returns tokens.
 *  - New principal signup: server 400s with `nin_and_bvn_required_for_principal_signup` —
 *    we expose NIN + BVN inputs that submit on the next tap.
 *
 * For simplicity, we always show NIN + BVN as optional fields. The server enforces
 * which combinations are valid; we surface its error code.
 */
export function VerifyScreen({ navigation }: Props): JSX.Element {
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const pendingPhone = useAuthStore((s) => s.pendingPhone);
  const busy = useAuthStore((s) => s.busy);
  const errorCode = useAuthStore((s) => s.errorCode);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', nin: '', bvn: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await verifyOtp({
        code: values.code,
        nin: values.nin?.length ? values.nin : undefined,
        bvn: values.bvn?.length ? values.bvn : undefined,
      });
      // RootNavigator will switch to MainStack when status === 'logged_in'.
    } catch {
      // errorCode set on store.
    }
  });

  if (!pendingPhone) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No phone selected</Text>
        <Pressable style={styles.button} onPress={() => navigation.navigate('Phone')}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Enter the 6-digit code</Text>
      <Text style={styles.muted}>Sent to {pendingPhone}</Text>

      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <View>
            <TextInput
              autoFocus
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="123456"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      <Text style={styles.section}>If this is your first time, also enter:</Text>

      <Controller
        control={control}
        name="nin"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>NIN</Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={11}
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="11 digits"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      <Controller
        control={control}
        name="bvn"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>BVN</Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={11}
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="11 digits"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      {errorCode && <Text style={styles.err}>Server: {errorCode}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={busy || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          (busy || formState.isSubmitting) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>{busy ? 'Verifying…' : 'Verify'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  section: { fontSize: 14, fontWeight: '600', marginTop: 16 },
  muted: { color: '#666' },
  label: { fontSize: 12, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/VerifyScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): VerifyScreen — OTP + optional NIN/BVN signup → log in"
```

---

## Phase F — polish + tag (Tasks 15-17)

### Task 15 — Smoke-boot the app + wire EXPO_PUBLIC_BACKEND_URL

**Files:**
- Modify: `apps/principal/app.json` (ensure `experiments.tsconfigPaths` is set if needed; add no-op if not required)

- [ ] **Step 1: Boot the dev server**

In one terminal, start the backend:

```bash
cd "C:/Users/alex_/amana"
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend dev
```

In another:

```bash
cd "C:/Users/alex_/amana"
EXPO_PUBLIC_BACKEND_URL=http://localhost:3000 pnpm --filter @amana/principal start
```

(On Windows PowerShell: `$env:EXPO_PUBLIC_BACKEND_URL='http://localhost:3000'; pnpm --filter @amana/principal start`)

- [ ] **Step 2: Manual smoke (no commit, just verification)**

Open the Expo Go app or an iOS/Android simulator. Confirm:
1. App launches → splash → Phone screen.
2. Enter `+2348012345678` → Send code.
3. Backend logs show "TERMII_API_KEY not set, skipping send" (since dev has no API key).
4. In a third terminal, query the DB for the OTP code (decrypt isn't possible — argon2id is one-way. You need to spy via the test path; for manual smoke, set a known seed.):

   Easiest path: temporarily mock `generateOtpCode` by setting it to a known value in dev only — OR add a one-line dev-only console log of the issued code in `otp.service.requestCode` GUARDED by `env.NODE_ENV !== 'production'`. **This is a deliberate dev-only convenience. Production must never log codes.**

   Skip Step 2 if you don't want to add the dev log. Move to T16; manual smoke can be done in 6c when the agent app is integrated against a Termii sandbox.

- [ ] **Step 3: No commit needed if you didn't change anything.**

If you added the dev-only log, commit:

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/otp.service.ts
git -C "C:/Users/alex_/amana" commit -m "chore(otp): log issued code in non-production for dev smoke"
```

---

### Task 16 — README for `apps/principal`

**Files:**
- Modify: `apps/principal/README.md`

- [ ] **Step 1: README**

Replace the existing `apps/principal/README.md` (or create if missing) with:

```markdown
# @amana/principal

The Amana Principal mobile app — Expo SDK 51 + React Native 0.74.5.

## What it does (Sub-plan 6b-1)

- Phone-OTP login against the v0.0.6a-auth backend.
- Persists tokens via `expo-secure-store`; auto-refreshes the access token on 401.
- Fresh principals sign up by entering NIN + BVN at the Verify step (server stamps `kycTier=1`; tier-2 upgrade lands later).
- Placeholder Home screen with a Log-out button.

## Run locally

```bash
# Terminal 1 — backend
cd ../../apps/backend
docker compose up -d
pnpm db:migrate
pnpm dev

# Terminal 2 — Expo dev server
EXPO_PUBLIC_BACKEND_URL=http://localhost:3000 pnpm start
```

(On Windows PowerShell: `$env:EXPO_PUBLIC_BACKEND_URL='http://localhost:3000'; pnpm start`)

If the device can't reach `localhost`, swap the URL for your LAN IP (`http://192.168.x.x:3000`) and ensure the backend is bound to `0.0.0.0`.

## Architecture

- `App.tsx` — root.
- `src/nav/RootNavigator.tsx` — switches between `AuthStack` and `MainStack` on `auth.status`.
- `src/state/auth.store.ts` — Zustand auth store; bootstrap reads from `secure-token-store`, validates via `/me`.
- `src/lib/api.ts` — `AmanaApiClient` singleton (bearer header + 401 single-flight refresh).
- `src/lib/secure-token-store.ts` — `TokenStore` impl using `expo-secure-store`.
- `src/screens/{Phone,Verify,Home,Splash}Screen.tsx` — screens.

## Tech stack

- React Navigation v7 (native-stack)
- Zustand 5
- react-hook-form + zod
- expo-secure-store (token persistence)
- expo-notifications (registered, not yet wired — Sub-plan 6b-2)

## Testing

Logic tests for the API client live in `packages/api-client/tests/`. Mobile screens are typecheck-validated only:

```bash
pnpm typecheck
```

Manual smoke: Expo Go or simulator (see Run locally).
```

- [ ] **Step 2: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/README.md
git -C "C:/Users/alex_/amana" commit -m "docs(principal): document 6b-1 surface (auth flow, run, architecture)"
```

---

### Task 17 — Full sweep + push + tag v0.0.6b1-principal-auth

**Files:** none.

- [ ] **Step 1: Full sweep**

```bash
cd "C:/Users/alex_/amana"
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm build 2>&1 | tail -10
pnpm exec biome check . 2>&1 | tail -5
pnpm typecheck 2>&1 | tail -10
pnpm --filter @amana/api-client test 2>&1 | tail -10
pnpm --filter @amana/backend test 2>&1 | tail -10
docker compose down
```

Expected:
- Build: 6/6 packages green.
- Biome: 0 errors, ≤13 warnings (the pre-existing noNonNullAssertion ones).
- Typecheck: 9/9 packages clean.
- api-client tests: ≥15 passing (Errors 5, AuthApi 5, Client 5).
- backend tests: 365 passed | 1 skipped (unchanged).

If biome auto-fix is needed, run `pnpm exec biome check --write .` and commit:

```bash
git -C "C:/Users/alex_/amana" add -A
git -C "C:/Users/alex_/amana" commit -m "style: biome auto-format (Sub-plan 6b-1 sweep)"
```

- [ ] **Step 2: Push + tag**

```bash
cd "C:/Users/alex_/amana"
git -C "C:/Users/alex_/amana" push origin main
git -C "C:/Users/alex_/amana" tag -a v0.0.6b1-principal-auth -m "Sub-plan 6b-1 complete: Principal mobile app — auth flow + shell"
git -C "C:/Users/alex_/amana" push origin v0.0.6b1-principal-auth
```

- [ ] **Step 3: Verify CI** at https://github.com/Alexander77063/amana/actions.

---

## Plan complete

When all 17 tasks land green:

- A principal can install the Expo app, sign up via phone+NIN+BVN, log in, see a placeholder home, and log out.
- Tokens persist across app restarts (encrypted via expo-secure-store).
- Access tokens auto-refresh on 401 (single-flight); failed refresh logs the user out.
- The `@amana/api-client` package has typed methods + tests for the full auth surface; future sub-plans extend it for /transactions, /bumps, etc.
- Sub-plan 6b-2 (household + sub-wallet management UI) builds against this shell.

## Out-of-scope for this slice (handled later)

- Push notification registration via `/devices` (the dep is installed; wiring lands in 6b-3 once the inbox screens exist).
- Household setup UI (6b-2).
- Sub-wallet creation + rule-set management (6b-2).
- Bump approval inbox (6b-3).
- Notification preferences UI (6b-3).
- Real KYC tier-2 upgrade (Sub-plan 7).
- Mobile-side jest tests for screens (deferred — typecheck + manual smoke for now).
- Theming + design system (deferred — bare RN styles are fine for the auth slice).
