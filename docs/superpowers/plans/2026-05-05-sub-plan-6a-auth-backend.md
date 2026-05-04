# Sub-plan 6a — Auth backend (phone OTP + JWT + pairing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `x-actor-*` placeholder middleware with phone-OTP login → JWT access + opaque refresh tokens, plus pairing-token onboarding for agents. After this plan ships, every protected route requires a bearer token signed by us, and Sub-plan 6b/6c (mobile apps) can build against real auth.

**Architecture:** Three additive tables (`phone_otp_challenges`, `auth_sessions`, `pairing_tokens`). OTP delivered via the existing Termii SMS provider. Access tokens are JWT (`HS256`, 5-min TTL, claims = `{sub, role, sid, iat, exp, jti}`). Refresh tokens are opaque random strings (32 bytes, base64url) stored as argon2id hashes with 30-day TTL and rotation-on-refresh. `jwt-auth` middleware replaces `actor()` everywhere; `actor()` middleware file is deleted at the end. All existing tests migrate to a `bearerHeaders(user)` helper that mints a valid access token for a seeded user.

**Tech Stack:** TypeScript + Hono + Drizzle + postgres-js + Vitest + `jose` (JWT) + `argon2` (password-grade hashing) + the existing `termiiSmsProvider`.

---

## File structure produced by this plan

**New source files:**
- `apps/backend/src/db/schema/auth.ts` — three new tables
- `apps/backend/src/modules/auth/types.ts`
- `apps/backend/src/modules/auth/codes.ts` — OTP code generation + hashing
- `apps/backend/src/modules/auth/tokens.ts` — JWT sign/verify, refresh-token gen/hash
- `apps/backend/src/modules/auth/otp-challenges.repo.ts`
- `apps/backend/src/modules/auth/auth-sessions.repo.ts`
- `apps/backend/src/modules/auth/pairing-tokens.repo.ts`
- `apps/backend/src/modules/auth/otp.service.ts`
- `apps/backend/src/modules/auth/session.service.ts`
- `apps/backend/src/modules/auth/pairing.service.ts`
- `apps/backend/src/modules/auth/index.ts`
- `apps/backend/src/middleware/jwt-auth.ts` (replaces `actor.ts`)
- `apps/backend/src/routes/auth.ts`
- `apps/backend/src/routes/pairing.ts`
- `apps/backend/tests/helpers/bearer.ts` — `bearerHeaders(user)` test helper
- 8 new test files (one per service + the routes)

**Modified files:**
- `apps/backend/src/env.ts` — add `JWT_SECRET`, `JWT_ISSUER`
- `apps/backend/src/db/schema/index.ts` — re-export auth schema
- `apps/backend/src/server.ts` — mount auth + pairing routes
- All existing route files (~7) — swap `actor()` for `jwtAuth()`
- All existing test files using `x-actor-*` (~20) — swap for `bearerHeaders(user)`
- `apps/backend/src/modules/index.ts` — re-export auth module
- `apps/backend/README.md`

**Deleted:**
- `apps/backend/src/middleware/actor.ts` (after migration complete)

---

## Phase A — Schema (Tasks 1-3)

### Task 1: Add auth tables to Drizzle schema

**Files:**
- Create: `apps/backend/src/db/schema/auth.ts`
- Modify: `apps/backend/src/db/schema/index.ts`

- [ ] **Step 1: Schema file**

```ts
// apps/backend/src/db/schema/auth.ts
import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { households, users } from './identity';

export const phoneOtpChallenges = pgTable(
  'phone_otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    purpose: text('purpose', { enum: ['login', 'pair'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPhonePending: uniqueIndex('phone_otp_challenges_by_phone_pending')
      .on(t.phone)
      .where(sql`consumed_at IS NULL`),
  }),
);

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pairingTokens = pgTable('pairing_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  principalUserId: uuid('principal_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedByUserId: uuid('consumed_by_user_id').references(() => users.id),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Re-export from schema index**

In `apps/backend/src/db/schema/index.ts`, add:

```ts
export * from './auth';
```

- [ ] **Step 3: Generate + verify migration**

```bash
cd "C:/Users/alex_/amana/apps/backend"
pnpm exec drizzle-kit generate
```

Confirm a new file `migrations/000X_<auto-name>.sql` exists creating the three tables. Inspect it for sanity: three CREATE TABLE statements, the partial unique index on `phone_otp_challenges`, FKs to users + households.

- [ ] **Step 4: Apply + verify**

```bash
cd "C:/Users/alex_/amana"
docker compose up -d
pnpm --filter @amana/backend db:migrate
```

In a psql prompt or via `pnpm --filter @amana/backend exec psql -c "\dt"` confirm the three tables exist. Stop docker afterwards.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/db/schema/auth.ts apps/backend/src/db/schema/index.ts apps/backend/migrations
git -C "C:/Users/alex_/amana" commit -m "feat(db): auth schema (phone OTP challenges + sessions + pairing tokens)"
```

---

### Task 2: Add `JWT_SECRET` + `JWT_ISSUER` to env loader

**Files:**
- Modify: `apps/backend/src/env.ts`

- [ ] **Step 1: Add to schema**

Find the `EnvSchema = z.object({ ... })` block and add:

```ts
JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
JWT_ISSUER: z.string().default('amana'),
JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(300),
JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
PAIRING_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24),
```

- [ ] **Step 2: Provide a dev default for local testing**

In the same file, find the `loadEnv` function. Add a fallback **only when `NODE_ENV !== 'production'`** for `JWT_SECRET`:

```ts
const merged: NodeJS.ProcessEnv = { ...source };
if (merged.NODE_ENV !== 'production' && !merged.JWT_SECRET) {
  merged.JWT_SECRET = 'dev-only-secret-do-not-use-in-prod-please-32+chars';
}
return EnvSchema.parse(merged);
```

This keeps tests + local dev unblocked without a real secret in `.env.test`. Production must set the env var explicitly or boot fails.

- [ ] **Step 3: Run env tests** to confirm they still pass:

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/env.test.ts
```

If env doesn't have a test, skip this step.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/env.ts
git -C "C:/Users/alex_/amana" commit -m "feat(env): JWT + OTP + pairing TTL/secret env vars (dev fallback for non-prod)"
```

---

### Task 3: Install crypto deps

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend add jose argon2
```

`jose` for JWT (modern, audited, ESM). `argon2` for password-grade hashing (refresh tokens + OTP codes — overkill for OTP but cheap and correct).

- [ ] **Step 2: Smoke-import**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend exec node -e "require('jose'); require('argon2'); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/package.json pnpm-lock.yaml
git -C "C:/Users/alex_/amana" commit -m "chore(backend): add jose + argon2 deps for auth"
```

---

## Phase B — Crypto utilities (Tasks 4-6)

### Task 4: Auth types

**Files:**
- Create: `apps/backend/src/modules/auth/types.ts`

- [ ] **Step 1: Types**

```ts
// apps/backend/src/modules/auth/types.ts
import type { phoneOtpChallenges, authSessions, pairingTokens } from '../../db/schema';

export type OtpChallengeRow = typeof phoneOtpChallenges.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type PairingTokenRow = typeof pairingTokens.$inferSelect;

export type OtpPurpose = 'login' | 'pair';

export type AccessTokenClaims = {
  sub: string;       // user id
  role: 'principal' | 'agent';
  sid: string;       // session id
  iat: number;
  exp: number;
  jti: string;
  iss: string;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  sessionId: string;
};
```

- [ ] **Step 2: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/types.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): types (OtpChallengeRow, AuthSessionRow, PairingTokenRow, AccessTokenClaims, IssuedTokens)"
```

---

### Task 5: OTP code generation + hashing

**Files:**
- Create: `apps/backend/src/modules/auth/codes.ts`
- Create: `apps/backend/tests/modules/auth/codes.test.ts`

- [ ] **Step 1: Codes module**

```ts
// apps/backend/src/modules/auth/codes.ts
import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

/** Six-digit numeric OTP, zero-padded. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function hashCode(code: string): Promise<string> {
  return argon2.hash(code, { type: argon2.argon2id });
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, code);
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/modules/auth/codes.test.ts
import { describe, expect, it } from 'vitest';
import { generateOtpCode, hashCode, verifyCode } from '../../../src/modules/auth/codes';

describe('codes', () => {
  it('generates 6-digit numeric codes', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('hash + verify round trip', async () => {
    const code = '123456';
    const hash = await hashCode(code);
    expect(await verifyCode(code, hash)).toBe(true);
    expect(await verifyCode('654321', hash)).toBe(false);
  });

  it('verifyCode returns false on invalid hash, never throws', async () => {
    expect(await verifyCode('123456', 'not-a-real-hash')).toBe(false);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/codes.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/codes.ts apps/backend/tests/modules/auth/codes.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): generateOtpCode + argon2id hash/verify"
```

---

### Task 6: JWT + refresh-token utilities

**Files:**
- Create: `apps/backend/src/modules/auth/tokens.ts`
- Create: `apps/backend/tests/modules/auth/tokens.test.ts`

- [ ] **Step 1: Tokens module**

```ts
// apps/backend/src/modules/auth/tokens.ts
import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../env';
import type { AccessTokenClaims } from './types';

const secretKey = (): Uint8Array => new TextEncoder().encode(env.JWT_SECRET);

export type SignAccessInput = {
  userId: string;
  role: 'principal' | 'agent';
  sessionId: string;
  now?: Date;
};

export async function signAccessToken(input: SignAccessInput): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + env.JWT_ACCESS_TTL_SECONDS;
  const jti = randomUUID();
  const token = await new SignJWT({ role: input.role, sid: input.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.userId)
    .setIssuer(env.JWT_ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(secretKey());
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: env.JWT_ISSUER,
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string') throw new Error('jwt: missing sub');
  if (typeof payload.sid !== 'string') throw new Error('jwt: missing sid');
  if (payload.role !== 'principal' && payload.role !== 'agent') throw new Error('jwt: bad role');
  return {
    sub: payload.sub,
    role: payload.role,
    sid: payload.sid,
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
    iss: payload.iss as string,
  };
}

/** Generates a 32-byte URL-safe random refresh token. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function hashRefreshToken(refresh: string): Promise<string> {
  return argon2.hash(refresh, { type: argon2.argon2id });
}

export async function verifyRefreshToken(refresh: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, refresh);
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/modules/auth/tokens.test.ts
import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../../src/modules/auth/tokens';

describe('tokens', () => {
  it('access token round-trip carries sub + role + sid', async () => {
    const { token, expiresAt } = await signAccessToken({
      userId: '11111111-1111-1111-1111-111111111111',
      role: 'principal',
      sessionId: '22222222-2222-2222-2222-222222222222',
    });
    expect(token.split('.').length).toBe(3);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.role).toBe('principal');
    expect(claims.sid).toBe('22222222-2222-2222-2222-222222222222');
    expect(claims.iss).toBe('amana');
  });

  it('verifyAccessToken rejects garbage', async () => {
    await expect(verifyAccessToken('not.a.jwt')).rejects.toThrow();
    await expect(verifyAccessToken('a.b.c')).rejects.toThrow();
  });

  it('refresh token: 43-char base64url, hash + verify roundtrip', async () => {
    const refresh = generateRefreshToken();
    expect(refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = await hashRefreshToken(refresh);
    expect(await verifyRefreshToken(refresh, hash)).toBe(true);
    expect(await verifyRefreshToken('wrong-token', hash)).toBe(false);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/tokens.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/tokens.ts apps/backend/tests/modules/auth/tokens.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): JWT (HS256) + refresh-token gen/hash/verify"
```

---

## Phase C — Repos (Tasks 7-9)

### Task 7: otpChallenges.repo

**Files:**
- Create: `apps/backend/src/modules/auth/otp-challenges.repo.ts`
- Create: `apps/backend/tests/modules/auth/otp-challenges.repo.test.ts`

- [ ] **Step 1: Repo**

```ts
// apps/backend/src/modules/auth/otp-challenges.repo.ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { phoneOtpChallenges } from '../../db/schema';
import type { OtpChallengeRow, OtpPurpose } from './types';

type DbOrTx = PostgresJsDatabase;

export type InsertChallengeInput = {
  phone: string;
  codeHash: string;
  purpose: OtpPurpose;
  expiresAt: Date;
};

export const otpChallengesRepo = {
  /**
   * Insert a new pending challenge. The partial unique index forces only one
   * un-consumed challenge per phone — the caller invalidates the prior one
   * by marking it consumed before calling insert.
   */
  async insert(db: DbOrTx, input: InsertChallengeInput): Promise<OtpChallengeRow> {
    const [row] = await db.insert(phoneOtpChallenges).values(input).returning();
    if (!row) throw new Error('otpChallenges.insert returned no row');
    return row;
  },

  /** Find the pending challenge for a phone (un-consumed, not expired by SQL). */
  async findActiveByPhone(db: DbOrTx, phone: string, now: Date): Promise<OtpChallengeRow | undefined> {
    const [row] = await db
      .select()
      .from(phoneOtpChallenges)
      .where(
        and(
          eq(phoneOtpChallenges.phone, phone),
          isNull(phoneOtpChallenges.consumedAt),
          sql`${phoneOtpChallenges.expiresAt} > ${now}`,
        ),
      )
      .limit(1);
    return row;
  },

  async incrementAttempts(db: DbOrTx, id: string): Promise<number> {
    const [row] = await db
      .update(phoneOtpChallenges)
      .set({ attempts: sql`${phoneOtpChallenges.attempts} + 1` })
      .where(eq(phoneOtpChallenges.id, id))
      .returning({ attempts: phoneOtpChallenges.attempts });
    return row?.attempts ?? 0;
  },

  async markConsumed(db: DbOrTx, id: string, now: Date): Promise<void> {
    await db
      .update(phoneOtpChallenges)
      .set({ consumedAt: now })
      .where(eq(phoneOtpChallenges.id, id));
  },

  /** Invalidate any prior active challenge for the phone (caller does this before insert). */
  async invalidateActiveForPhone(db: DbOrTx, phone: string, now: Date): Promise<number> {
    const result = await db
      .update(phoneOtpChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(phoneOtpChallenges.phone, phone),
          isNull(phoneOtpChallenges.consumedAt),
        ),
      );
    return result.length ?? 0;
  },
};
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/modules/auth/otp-challenges.repo.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { otpChallengesRepo } from '../../../src/modules/auth/otp-challenges.repo';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('otpChallengesRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + findActiveByPhone returns the row', async () => {
    const expires = new Date(Date.now() + 60_000);
    const ch = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678',
      codeHash: 'h1',
      purpose: 'login',
      expiresAt: expires,
    });
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found?.id).toBe(ch.id);
  });

  it('expired challenge is not active', async () => {
    await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678',
      codeHash: 'h1',
      purpose: 'login',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found).toBeUndefined();
  });

  it('invalidateActiveForPhone clears prior pending so a new insert succeeds', async () => {
    await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678',
      codeHash: 'h1',
      purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await otpChallengesRepo.invalidateActiveForPhone(testDb, '+2348012345678', new Date());
    const ch2 = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678',
      codeHash: 'h2',
      purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found?.id).toBe(ch2.id);
  });

  it('incrementAttempts returns the new count', async () => {
    const ch = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678',
      codeHash: 'h1',
      purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await otpChallengesRepo.incrementAttempts(testDb, ch.id)).toBe(1);
    expect(await otpChallengesRepo.incrementAttempts(testDb, ch.id)).toBe(2);
  });

  it('markConsumed sets consumed_at and removes from active', async () => {
    const ch = await otpChallengesRepo.insert(testDb, {
      phone: '+2348012345678',
      codeHash: 'h1',
      purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await otpChallengesRepo.markConsumed(testDb, ch.id, new Date());
    const found = await otpChallengesRepo.findActiveByPhone(testDb, '+2348012345678', new Date());
    expect(found).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/otp-challenges.repo.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/otp-challenges.repo.ts apps/backend/tests/modules/auth/otp-challenges.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): otpChallengesRepo (insert/findActive/increment/markConsumed/invalidate)"
```

---

### Task 8: authSessions.repo

**Files:**
- Create: `apps/backend/src/modules/auth/auth-sessions.repo.ts`
- Create: `apps/backend/tests/modules/auth/auth-sessions.repo.test.ts`

- [ ] **Step 1: Repo**

```ts
// apps/backend/src/modules/auth/auth-sessions.repo.ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { authSessions } from '../../db/schema';
import type { AuthSessionRow } from './types';

type DbOrTx = PostgresJsDatabase;

export type InsertSessionInput = {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
};

export const authSessionsRepo = {
  async insert(db: DbOrTx, input: InsertSessionInput): Promise<AuthSessionRow> {
    const [row] = await db.insert(authSessions).values(input).returning();
    if (!row) throw new Error('authSessions.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<AuthSessionRow | undefined> {
    const [row] = await db.select().from(authSessions).where(eq(authSessions.id, id)).limit(1);
    return row;
  },

  /** Find all active (non-revoked, non-expired) sessions for a user. */
  async listActive(db: DbOrTx, userId: string, now: Date): Promise<AuthSessionRow[]> {
    return db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          sql`${authSessions.expiresAt} > ${now}`,
        ),
      )
      .orderBy(desc(authSessions.lastUsedAt));
  },

  async touchLastUsed(db: DbOrTx, id: string, now: Date): Promise<void> {
    await db.update(authSessions).set({ lastUsedAt: now }).where(eq(authSessions.id, id));
  },

  /** Rotate: revoke this session, return the new session inserted in its place. */
  async rotate(
    db: DbOrTx,
    sessionId: string,
    newInput: InsertSessionInput,
    now: Date,
  ): Promise<AuthSessionRow> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      await txDb
        .update(authSessions)
        .set({ revokedAt: now })
        .where(eq(authSessions.id, sessionId));
      const [row] = await txDb.insert(authSessions).values(newInput).returning();
      if (!row) throw new Error('authSessions.rotate insert returned no row');
      return row;
    });
  },

  async revoke(db: DbOrTx, id: string, now: Date): Promise<void> {
    await db.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, id));
  },
};
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/modules/auth/auth-sessions.repo.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { authSessionsRepo } from '../../../src/modules/auth/auth-sessions.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('authSessionsRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + findById', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const s = await authSessionsRepo.insert(testDb, {
      userId: u.id, refreshTokenHash: 'h1',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const f = await authSessionsRepo.findById(testDb, s.id);
    expect(f?.userId).toBe(u.id);
  });

  it('listActive excludes revoked + expired', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const active = await authSessionsRepo.insert(testDb, {
      userId: u.id, refreshTokenHash: 'a',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const expired = await authSessionsRepo.insert(testDb, {
      userId: u.id, refreshTokenHash: 'b',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const revoked = await authSessionsRepo.insert(testDb, {
      userId: u.id, refreshTokenHash: 'c',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    await authSessionsRepo.revoke(testDb, revoked.id, new Date());
    const list = await authSessionsRepo.listActive(testDb, u.id, new Date());
    expect(list.map((r) => r.id)).toEqual([active.id]);
    expect(list).not.toContainEqual(expect.objectContaining({ id: expired.id }));
  });

  it('rotate revokes old + inserts new in single transaction', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const old = await authSessionsRepo.insert(testDb, {
      userId: u.id, refreshTokenHash: 'old',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const fresh = await authSessionsRepo.rotate(
      testDb, old.id,
      { userId: u.id, refreshTokenHash: 'new', expiresAt: new Date(Date.now() + 1_000_000) },
      new Date(),
    );
    const oldNow = await authSessionsRepo.findById(testDb, old.id);
    expect(oldNow?.revokedAt).not.toBeNull();
    expect(fresh.refreshTokenHash).toBe('new');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/auth-sessions.repo.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/auth-sessions.repo.ts apps/backend/tests/modules/auth/auth-sessions.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): authSessionsRepo (insert/findById/listActive/rotate/revoke/touchLastUsed)"
```

---

### Task 9: pairingTokens.repo

**Files:**
- Create: `apps/backend/src/modules/auth/pairing-tokens.repo.ts`
- Create: `apps/backend/tests/modules/auth/pairing-tokens.repo.test.ts`

- [ ] **Step 1: Repo**

```ts
// apps/backend/src/modules/auth/pairing-tokens.repo.ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pairingTokens } from '../../db/schema';
import type { PairingTokenRow } from './types';

type DbOrTx = PostgresJsDatabase;

export type InsertPairingInput = {
  principalUserId: string;
  householdId: string;
  code: string;
  expiresAt: Date;
};

export const pairingTokensRepo = {
  async insert(db: DbOrTx, input: InsertPairingInput): Promise<PairingTokenRow> {
    const [row] = await db.insert(pairingTokens).values(input).returning();
    if (!row) throw new Error('pairingTokens.insert returned no row');
    return row;
  },

  /** Find an active (un-consumed, not expired) pairing token by its code. */
  async findActiveByCode(db: DbOrTx, code: string, now: Date): Promise<PairingTokenRow | undefined> {
    const [row] = await db
      .select()
      .from(pairingTokens)
      .where(
        and(
          eq(pairingTokens.code, code),
          isNull(pairingTokens.consumedAt),
          sql`${pairingTokens.expiresAt} > ${now}`,
        ),
      )
      .limit(1);
    return row;
  },

  async markConsumed(db: DbOrTx, id: string, consumedByUserId: string, now: Date): Promise<void> {
    await db
      .update(pairingTokens)
      .set({ consumedByUserId, consumedAt: now })
      .where(eq(pairingTokens.id, id));
  },
};
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/modules/auth/pairing-tokens.repo.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { pairingTokensRepo } from '../../../src/modules/auth/pairing-tokens.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('pairingTokensRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + findActiveByCode', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const t = await pairingTokensRepo.insert(testDb, {
      principalUserId: principal.id, householdId: hh.id,
      code: 'PAIR-CODE-123', expiresAt: new Date(Date.now() + 60_000),
    });
    const f = await pairingTokensRepo.findActiveByCode(testDb, 'PAIR-CODE-123', new Date());
    expect(f?.id).toBe(t.id);
  });

  it('expired token is not active', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await pairingTokensRepo.insert(testDb, {
      principalUserId: principal.id, householdId: hh.id,
      code: 'EXPIRED', expiresAt: new Date(Date.now() - 60_000),
    });
    const f = await pairingTokensRepo.findActiveByCode(testDb, 'EXPIRED', new Date());
    expect(f).toBeUndefined();
  });

  it('markConsumed sets consumed_at + consumed_by_user_id', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const t = await pairingTokensRepo.insert(testDb, {
      principalUserId: principal.id, householdId: hh.id,
      code: 'CODE', expiresAt: new Date(Date.now() + 60_000),
    });
    await pairingTokensRepo.markConsumed(testDb, t.id, agent.id, new Date());
    const f = await pairingTokensRepo.findActiveByCode(testDb, 'CODE', new Date());
    expect(f).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/pairing-tokens.repo.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/pairing-tokens.repo.ts apps/backend/tests/modules/auth/pairing-tokens.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): pairingTokensRepo (insert/findActiveByCode/markConsumed)"
```

---

## Phase D — OTP + Session services (Tasks 10-11)

### Task 10: otp.service — request + verify

**Files:**
- Create: `apps/backend/src/modules/auth/otp.service.ts`
- Create: `apps/backend/tests/modules/auth/otp.service.test.ts`

- [ ] **Step 1: Service**

```ts
// apps/backend/src/modules/auth/otp.service.ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import { generateOtpCode, hashCode, verifyCode } from './codes';
import { otpChallengesRepo } from './otp-challenges.repo';
import type { OtpPurpose } from './types';

type DbOrTx = PostgresJsDatabase;

export type RequestCodeInput = { phone: string; purpose: OtpPurpose };
export type RequestCodeResult = { challengeId: string; expiresAt: Date };

export type VerifyCodeInput = { phone: string; code: string };
export type VerifyCodeResult =
  | { kind: 'verified'; challengeId: string; purpose: OtpPurpose }
  | { kind: 'no_challenge' }
  | { kind: 'too_many_attempts' }
  | { kind: 'wrong_code' };

/** Termii sender boundary — kept in this module for now; mocked in tests. */
async function sendSms(phone: string, code: string): Promise<void> {
  if (!env.TERMII_API_KEY) {
    logger.warn({ phone }, 'otp: TERMII_API_KEY not set, skipping send (dev mode)');
    return;
  }
  const res = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      to: phone,
      from: env.TERMII_SENDER_ID,
      sms: `Your Amana verification code is ${code}. Expires in 5 minutes.`,
      type: 'plain',
      channel: 'generic',
      api_key: env.TERMII_API_KEY,
    }),
  });
  if (!res.ok) {
    logger.error({ phone, status: res.status }, 'otp: termii send failed');
    throw new Error(`termii: ${res.status}`);
  }
}

export const otpService = {
  async requestCode(db: DbOrTx, input: RequestCodeInput): Promise<RequestCodeResult> {
    const now = new Date();
    const code = generateOtpCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);

    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      await otpChallengesRepo.invalidateActiveForPhone(txDb, input.phone, now);
      const ch = await otpChallengesRepo.insert(txDb, {
        phone: input.phone,
        codeHash,
        purpose: input.purpose,
        expiresAt,
      });
      await sendSms(input.phone, code);
      return { challengeId: ch.id, expiresAt };
    });
  },

  async verifyCode(db: DbOrTx, input: VerifyCodeInput): Promise<VerifyCodeResult> {
    const now = new Date();
    const ch = await otpChallengesRepo.findActiveByPhone(db, input.phone, now);
    if (!ch) return { kind: 'no_challenge' as const };
    if (ch.attempts >= env.OTP_MAX_ATTEMPTS) {
      return { kind: 'too_many_attempts' as const };
    }
    const ok = await verifyCode(input.code, ch.codeHash);
    if (!ok) {
      await otpChallengesRepo.incrementAttempts(db, ch.id);
      return { kind: 'wrong_code' as const };
    }
    await otpChallengesRepo.markConsumed(db, ch.id, now);
    return { kind: 'verified' as const, challengeId: ch.id, purpose: ch.purpose };
  },
};
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/modules/auth/otp.service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { otpService } from '../../../src/modules/auth/otp.service';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(async () => {
  await truncateAll();
  // Use the test env (no TERMII_API_KEY) so the SMS path skips.
  delete process.env.TERMII_API_KEY;
});

afterEach(() => vi.restoreAllMocks());

describe('otpService.requestCode', () => {
  it('returns a challenge id with future expiry', async () => {
    const r = await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    expect(r.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('a second request invalidates the first (one active per phone)', async () => {
    const r1 = await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    const r2 = await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    expect(r2.challengeId).not.toBe(r1.challengeId);
  });
});

describe('otpService.verifyCode', () => {
  it('no_challenge when no pending request exists', async () => {
    const r = await otpService.verifyCode(testDb, { phone: '+2348012345678', code: '000000' });
    expect(r.kind).toBe('no_challenge');
  });

  it('wrong_code increments attempts; too_many_attempts after MAX', async () => {
    await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    for (let i = 0; i < 5; i++) {
      const r = await otpService.verifyCode(testDb, { phone: '+2348012345678', code: '999999' });
      expect(r.kind).toBe('wrong_code');
    }
    const blocked = await otpService.verifyCode(testDb, { phone: '+2348012345678', code: '999999' });
    expect(blocked.kind).toBe('too_many_attempts');
  });

  it('verified path: spy generateOtpCode to know the code, then verify', async () => {
    const codes = await import('../../../src/modules/auth/codes');
    const spy = vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
    await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    spy.mockRestore();
    const r = await otpService.verifyCode(testDb, { phone: '+2348012345678', code: '123456' });
    expect(r.kind).toBe('verified');
  });

  it('verifying twice — second call sees no active challenge (consumed)', async () => {
    const codes = await import('../../../src/modules/auth/codes');
    const spy = vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
    await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    spy.mockRestore();
    await otpService.verifyCode(testDb, { phone: '+2348012345678', code: '123456' });
    const second = await otpService.verifyCode(testDb, { phone: '+2348012345678', code: '123456' });
    expect(second.kind).toBe('no_challenge');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/otp.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/otp.service.ts apps/backend/tests/modules/auth/otp.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): otp.service (requestCode + verifyCode w/ rate limit + Termii SMS)"
```

---

### Task 11: session.service — issue + refresh + revoke

**Files:**
- Create: `apps/backend/src/modules/auth/session.service.ts`
- Create: `apps/backend/tests/modules/auth/session.service.test.ts`

- [ ] **Step 1: Service**

```ts
// apps/backend/src/modules/auth/session.service.ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { authSessionsRepo } from './auth-sessions.repo';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyRefreshToken,
} from './tokens';
import type { IssuedTokens } from './types';

type DbOrTx = PostgresJsDatabase;

export type IssueInput = {
  userId: string;
  role: 'principal' | 'agent';
  now?: Date;
};

export type RefreshResult =
  | { kind: 'rotated'; tokens: IssuedTokens }
  | { kind: 'invalid' }
  | { kind: 'revoked' }
  | { kind: 'expired' };

export const sessionService = {
  async issue(db: DbOrTx, input: IssueInput): Promise<IssuedTokens> {
    const now = input.now ?? new Date();
    const refresh = generateRefreshToken();
    const refreshHash = await hashRefreshToken(refresh);
    const refreshExpires = new Date(now.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);
    const session = await authSessionsRepo.insert(db, {
      userId: input.userId,
      refreshTokenHash: refreshHash,
      expiresAt: refreshExpires,
    });
    const access = await signAccessToken({
      userId: input.userId,
      role: input.role,
      sessionId: session.id,
      now,
    });
    return {
      accessToken: access.token,
      refreshToken: refresh,
      accessExpiresAt: access.expiresAt,
      refreshExpiresAt: refreshExpires,
      sessionId: session.id,
    };
  },

  /**
   * Verify a refresh token: rotate to a fresh session+refresh+access.
   *
   * Linear scan over the user's active sessions is acceptable: refresh-token-hash
   * uniqueness is enforced at the DB level so we look up the (single) matching
   * row by argon2-verifying the supplied token against each candidate hash.
   * Active sessions per user are bounded (~handful of devices) — not a hot path.
   */
  async refresh(
    db: DbOrTx,
    refreshToken: string,
    role: 'principal' | 'agent',
    userId: string,
    now: Date = new Date(),
  ): Promise<RefreshResult> {
    const candidates = await authSessionsRepo.listActive(db, userId, now);
    for (const candidate of candidates) {
      const matches = await verifyRefreshToken(refreshToken, candidate.refreshTokenHash);
      if (!matches) continue;
      const newRefresh = generateRefreshToken();
      const newHash = await hashRefreshToken(newRefresh);
      const newExpires = new Date(now.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);
      const fresh = await authSessionsRepo.rotate(
        db,
        candidate.id,
        { userId, refreshTokenHash: newHash, expiresAt: newExpires },
        now,
      );
      const access = await signAccessToken({
        userId,
        role,
        sessionId: fresh.id,
        now,
      });
      return {
        kind: 'rotated' as const,
        tokens: {
          accessToken: access.token,
          refreshToken: newRefresh,
          accessExpiresAt: access.expiresAt,
          refreshExpiresAt: newExpires,
          sessionId: fresh.id,
        },
      };
    }
    return { kind: 'invalid' as const };
  },

  async revoke(db: DbOrTx, sessionId: string, now: Date = new Date()): Promise<void> {
    await authSessionsRepo.revoke(db, sessionId, now);
  },
};
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/modules/auth/session.service.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { authSessionsRepo } from '../../../src/modules/auth/auth-sessions.repo';
import { sessionService } from '../../../src/modules/auth/session.service';
import { verifyAccessToken } from '../../../src/modules/auth/tokens';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('sessionService', () => {
  beforeEach(async () => { await truncateAll(); });

  it('issue returns access + refresh + sessionId; access JWT carries claims', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    expect(tokens.accessToken).toMatch(/\./);
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const claims = await verifyAccessToken(tokens.accessToken);
    expect(claims.sub).toBe(u.id);
    expect(claims.role).toBe('principal');
    expect(claims.sid).toBe(tokens.sessionId);
  });

  it('refresh rotates: new tokens, old session revoked', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const first = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const result = await sessionService.refresh(testDb, first.refreshToken, 'principal', u.id);
    if (result.kind !== 'rotated') throw new Error('expected rotated, got ' + result.kind);
    expect(result.tokens.refreshToken).not.toBe(first.refreshToken);
    expect(result.tokens.sessionId).not.toBe(first.sessionId);
    const oldSession = await authSessionsRepo.findById(testDb, first.sessionId);
    expect(oldSession?.revokedAt).not.toBeNull();
  });

  it('refresh with a bogus token returns invalid', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const r = await sessionService.refresh(testDb, 'not-a-real-refresh-token', 'principal', u.id);
    expect(r.kind).toBe('invalid');
  });

  it('refresh after revoke returns invalid', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const first = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    await sessionService.revoke(testDb, first.sessionId);
    const r = await sessionService.refresh(testDb, first.refreshToken, 'principal', u.id);
    expect(r.kind).toBe('invalid');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/session.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/session.service.ts apps/backend/tests/modules/auth/session.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): session.service (issue/refresh/revoke with rotation)"
```

---

## Phase E — Pairing service (Task 12)

### Task 12: pairing.service — issue + consume

**Files:**
- Create: `apps/backend/src/modules/auth/pairing.service.ts`
- Create: `apps/backend/tests/modules/auth/pairing.service.test.ts`

- [ ] **Step 1: Service**

```ts
// apps/backend/src/modules/auth/pairing.service.ts
import { randomBytes } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { householdMembersRepo } from '../identity/household-members.repo';
import { pairingTokensRepo } from './pairing-tokens.repo';
import type { PairingTokenRow } from './types';

type DbOrTx = PostgresJsDatabase;

export type IssuePairingInput = {
  principalUserId: string;
  householdId: string;
  now?: Date;
};

export type ConsumePairingInput = {
  code: string;
  agentUserId: string;
  now?: Date;
};

export type ConsumePairingResult =
  | { kind: 'consumed'; pairingTokenId: string; householdId: string }
  | { kind: 'not_found' }
  | { kind: 'wrong_role' };

/** 16 random URL-safe bytes ≈ 22 chars; readable, not a JWT, not stored client-side persistently. */
function generatePairingCode(): string {
  return randomBytes(16).toString('base64url');
}

export const pairingService = {
  async issue(db: DbOrTx, input: IssuePairingInput): Promise<PairingTokenRow> {
    const now = input.now ?? new Date();
    const code = generatePairingCode();
    const expiresAt = new Date(now.getTime() + env.PAIRING_TOKEN_TTL_SECONDS * 1000);
    return pairingTokensRepo.insert(db, {
      principalUserId: input.principalUserId,
      householdId: input.householdId,
      code,
      expiresAt,
    });
  },

  async consume(db: DbOrTx, input: ConsumePairingInput): Promise<ConsumePairingResult> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const token = await pairingTokensRepo.findActiveByCode(txDb, input.code, now);
      if (!token) return { kind: 'not_found' as const };
      await pairingTokensRepo.markConsumed(txDb, token.id, input.agentUserId, now);
      await householdMembersRepo.upsertActive(txDb, {
        householdId: token.householdId,
        userId: input.agentUserId,
      });
      return {
        kind: 'consumed' as const,
        pairingTokenId: token.id,
        householdId: token.householdId,
      };
    });
  },
};
```

- [ ] **Step 2: If `householdMembersRepo.upsertActive` doesn't exist yet** — open `apps/backend/src/modules/identity/household-members.repo.ts`, add (or confirm) the method:

```ts
// inside householdMembersRepo:
async upsertActive(
  db: DbOrTx,
  input: { householdId: string; userId: string },
): Promise<void> {
  await db
    .insert(householdMembers)
    .values({ householdId: input.householdId, userId: input.userId, status: 'active' })
    .onConflictDoUpdate({
      target: [householdMembers.householdId, householdMembers.userId],
      set: { status: 'active' },
    });
},
```

(The composite PK on `household_members` is `(household_id, user_id)` per the spec — confirm it's defined that way; if not, this is a schema bug to flag.)

- [ ] **Step 3: Test**

```ts
// apps/backend/tests/modules/auth/pairing.service.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { pairingService } from '../../../src/modules/auth/pairing.service';
import { householdMembersRepo } from '../../../src/modules/identity/household-members.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('pairingService', () => {
  beforeEach(async () => { await truncateAll(); });

  it('issue returns a token with the expected scope', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const t = await pairingService.issue(testDb, {
      principalUserId: principal.id, householdId: hh.id,
    });
    expect(t.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(t.principalUserId).toBe(principal.id);
    expect(t.householdId).toBe(hh.id);
  });

  it('consume links agent to household + marks token consumed', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const t = await pairingService.issue(testDb, {
      principalUserId: principal.id, householdId: hh.id,
    });
    const r = await pairingService.consume(testDb, { code: t.code, agentUserId: agent.id });
    expect(r.kind).toBe('consumed');
    if (r.kind === 'consumed') {
      expect(r.householdId).toBe(hh.id);
    }
    const members = await householdMembersRepo.listByHousehold(testDb, hh.id);
    expect(members.some((m) => m.userId === agent.id)).toBe(true);
  });

  it('consume with bad code returns not_found', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const r = await pairingService.consume(testDb, { code: 'nope', agentUserId: agent.id });
    expect(r.kind).toBe('not_found');
  });
});
```

If `householdMembersRepo.listByHousehold(db, householdId)` doesn't exist, add it to `apps/backend/src/modules/identity/household-members.repo.ts`:

```ts
async listByHousehold(db: DbOrTx, householdId: string): Promise<HouseholdMemberRow[]> {
  return db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
},
```

Same applies to `upsertActive` from Step 2 — both must be present before the test runs.

- [ ] **Step 4: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/modules/auth/pairing.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/pairing.service.ts apps/backend/tests/modules/auth/pairing.service.test.ts apps/backend/src/modules/identity/household-members.repo.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): pairing.service (issue/consume — links agent to household)"
```

---

## Phase F — JWT middleware (Tasks 13-14)

### Task 13: jwt-auth middleware

**Files:**
- Create: `apps/backend/src/middleware/jwt-auth.ts`

The middleware replaces `actor()`. Same `Variables: ActorVariables` contract so the rest of the app needs minimal change — only the middleware factory call site swaps.

- [ ] **Step 1: Middleware**

```ts
// apps/backend/src/middleware/jwt-auth.ts
import type { MiddlewareHandler } from 'hono';
import { authSessionsRepo } from '../modules/auth/auth-sessions.repo';
import { verifyAccessToken } from '../modules/auth/tokens';
import { db } from '../db/client';

export type Actor = { userId: string; role: 'principal' | 'agent'; sessionId: string };
export type ActorVariables = { actor: Actor };

export const jwtAuth = (): MiddlewareHandler<{ Variables: ActorVariables }> => async (c, next) => {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_bearer' }, 401);
  }
  const token = header.slice('Bearer '.length).trim();
  let claims: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  // Session must still be active. (We pay one DB read on every authed request;
  // for MVP this is acceptable. A token-bucket cache can be added in v1.x.)
  const session = await authSessionsRepo.findById(db, claims.sid);
  if (!session) return c.json({ error: 'session_not_found' }, 401);
  if (session.revokedAt) return c.json({ error: 'session_revoked' }, 401);
  if (session.expiresAt < new Date()) return c.json({ error: 'session_expired' }, 401);

  // Best-effort touch — don't block the request on this update.
  authSessionsRepo
    .touchLastUsed(db, session.id, new Date())
    .catch(() => {});

  c.set('actor', {
    userId: claims.sub,
    role: claims.role,
    sessionId: claims.sid,
  } satisfies Actor);
  await next();
};
```

- [ ] **Step 2: Commit (test arrives in T14)**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/middleware/jwt-auth.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): jwtAuth middleware (verify bearer + session, set actor)"
```

---

### Task 14: bearer test helper + middleware test

**Files:**
- Create: `apps/backend/tests/helpers/bearer.ts`
- Create: `apps/backend/tests/middleware/jwt-auth.test.ts`

- [ ] **Step 1: Helper**

```ts
// apps/backend/tests/helpers/bearer.ts
import { sessionService } from '../../src/modules/auth/session.service';
import type { UserRow } from '../../src/modules/identity/users.repo';
import { testDb } from './test-db';

/**
 * Mints a real access + refresh token for a seeded user and returns headers
 * suitable for app.request(...). The session is real and revocable.
 */
export async function bearerHeaders(user: UserRow): Promise<{
  Authorization: string;
  'content-type': string;
}> {
  const tokens = await sessionService.issue(testDb, { userId: user.id, role: user.role });
  return {
    Authorization: `Bearer ${tokens.accessToken}`,
    'content-type': 'application/json',
  };
}
```

(If `UserRow` isn't already exported from `users.repo.ts`, add `export type UserRow = typeof users.$inferSelect;` next to the existing types.)

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/middleware/jwt-auth.test.ts
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { jwtAuth, type ActorVariables } from '../../src/middleware/jwt-auth';
import { sessionService } from '../../src/modules/auth/session.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const buildApp = () => {
  const app = new Hono<{ Variables: ActorVariables }>().use(jwtAuth());
  app.get('/me', (c) => c.json({ actor: c.get('actor') }, 200));
  return app;
};

describe('jwtAuth middleware', () => {
  beforeEach(async () => { await truncateAll(); });

  it('401 missing_bearer when no Authorization header', async () => {
    const res = await buildApp().request('/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });

  it('401 invalid_token on malformed JWT', async () => {
    const res = await buildApp().request('/me', {
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
  });

  it('200 with actor on a valid token', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const res = await buildApp().request('/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { actor: { userId: string; role: string } };
    expect(body.actor.userId).toBe(u.id);
    expect(body.actor.role).toBe('principal');
  });

  it('401 session_revoked after revoke', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    await sessionService.revoke(testDb, tokens.sessionId);
    const res = await buildApp().request('/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'session_revoked' });
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/middleware/jwt-auth.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/tests/helpers/bearer.ts apps/backend/tests/middleware/jwt-auth.test.ts apps/backend/src/modules/identity/users.repo.ts
git -C "C:/Users/alex_/amana" commit -m "test(auth): jwtAuth middleware tests + bearerHeaders helper"
```

---

## Phase G — Routes (Tasks 15-18)

### Task 15: POST /auth/otp/request, POST /auth/otp/verify

**Files:**
- Create: `apps/backend/src/routes/auth.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/auth.test.ts`

The verify endpoint creates the user on first successful verify, then issues tokens. KYC tier on first signup defaults to `1` for any role (pre-KYC); a separate tier-upgrade flow lands later.

- [ ] **Step 1: Route**

```ts
// apps/backend/src/routes/auth.ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { jwtAuth, type ActorVariables } from '../middleware/jwt-auth';
import { otpService } from '../modules/auth/otp.service';
import { pairingService } from '../modules/auth/pairing.service';
import { sessionService } from '../modules/auth/session.service';
import { usersRepo } from '../modules/identity/users.repo';

const PHONE_RE = /^\+\d{8,15}$/;

export const authRoute = new Hono()
  .post('/otp/request', async (c) => {
    const body = await c.req.json<{ phone: string; purpose: 'login' | 'pair' }>();
    if (!PHONE_RE.test(body.phone)) {
      return c.json({ error: 'invalid_phone' }, 400);
    }
    if (body.purpose !== 'login' && body.purpose !== 'pair') {
      return c.json({ error: 'invalid_purpose' }, 400);
    }
    const r = await otpService.requestCode(db, { phone: body.phone, purpose: body.purpose });
    return c.json({ challengeId: r.challengeId, expiresAt: r.expiresAt.toISOString() }, 200);
  })
  .post('/otp/verify', async (c) => {
    const body = await c.req.json<{
      phone: string;
      code: string;
      pairingCode?: string;
      nin?: string;
      bvn?: string;
    }>();
    if (!PHONE_RE.test(body.phone)) {
      return c.json({ error: 'invalid_phone' }, 400);
    }
    const v = await otpService.verifyCode(db, { phone: body.phone, code: body.code });
    if (v.kind !== 'verified') {
      return c.json({ error: v.kind }, 401);
    }

    let user = await usersRepo.findByPhone(db, body.phone);

    // Path 1 — pairing flow (agent onboarding via principal-issued code).
    if (!user && body.pairingCode) {
      if (!body.nin) return c.json({ error: 'nin_required_for_signup' }, 400);
      user = await usersRepo.insert(db, {
        role: 'agent', phone: body.phone, nin: body.nin, kycTier: '1',
      });
      const consumed = await pairingService.consume(db, {
        code: body.pairingCode, agentUserId: user.id,
      });
      if (consumed.kind !== 'consumed') {
        return c.json({ error: 'pairing_failed', reason: consumed.kind }, 400);
      }
    }

    // Path 2 — fresh principal signup (no pairing code, no existing user).
    if (!user) {
      if (!body.nin || !body.bvn) {
        return c.json({ error: 'nin_and_bvn_required_for_principal_signup' }, 400);
      }
      user = await usersRepo.insert(db, {
        role: 'principal', phone: body.phone, nin: body.nin, bvn: body.bvn, kycTier: '1',
      });
      // Tier upgrade to '2' happens in a separate KYC-verification flow (out of scope here).
    }

    const tokens = await sessionService.issue(db, { userId: user.id, role: user.role });
    return c.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt.toISOString(),
      refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
      user: { id: user.id, role: user.role, phone: user.phone, kycTier: user.kycTier },
    }, 200);
  });

export const meRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me', async (c) => {
    const a = c.get('actor');
    const u = await usersRepo.findById(db, a.userId);
    if (!u) return c.json({ error: 'user_not_found' }, 404);
    return c.json({
      id: u.id, role: u.role, phone: u.phone, kycTier: u.kycTier, status: u.status,
    }, 200);
  });
```

- [ ] **Step 2: If `usersRepo.findByPhone` or `usersRepo.findById` doesn't exist** — add to `apps/backend/src/modules/identity/users.repo.ts`:

```ts
async findByPhone(db: DbOrTx, phone: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  return row;
},
async findById(db: DbOrTx, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
},
```

- [ ] **Step 3: Mount**

In `apps/backend/src/server.ts`, add:

```ts
import { authRoute, meRoute } from './routes/auth';
// ...
app.route('/auth', authRoute);
app.route('/', meRoute);
```

- [ ] **Step 4: Test**

```ts
// apps/backend/tests/routes/auth.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as codes from '../../src/modules/auth/codes';
import { createServer } from '../../src/server';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /auth/otp/request', () => {
  beforeEach(async () => {
    await truncateAll();
    delete process.env.TERMII_API_KEY;
  });

  it('returns challengeId for a valid phone', async () => {
    const app = createServer();
    const res = await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', purpose: 'login' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { challengeId: string; expiresAt: string };
    expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('400 on invalid phone format', async () => {
    const app = createServer();
    const res = await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '0801', purpose: 'login' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/otp/verify (principal signup)', () => {
  beforeEach(async () => {
    await truncateAll();
    delete process.env.TERMII_API_KEY;
  });

  it('signs up new principal and returns tokens', async () => {
    const spy = vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
    const app = createServer();
    await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', purpose: 'login' }),
    });
    spy.mockRestore();

    const res = await app.request('/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: '+2348012345678',
        code: '123456',
        nin: '12345678901',
        bvn: '12345678901',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { accessToken: string; user: { role: string } };
    expect(body.accessToken).toMatch(/\./);
    expect(body.user.role).toBe('principal');
  });

  it('401 wrong_code on bad otp', async () => {
    const app = createServer();
    await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', purpose: 'login' }),
    });
    const res = await app.request('/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', code: '000000' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'wrong_code' });
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/auth.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/auth.ts apps/backend/src/server.ts apps/backend/src/modules/identity/users.repo.ts apps/backend/tests/routes/auth.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): POST /auth/otp/request + /auth/otp/verify + GET /me"
```

---

### Task 16: POST /auth/refresh + POST /auth/logout

**Files:**
- Modify: `apps/backend/src/routes/auth.ts`
- Modify: `apps/backend/tests/routes/auth.test.ts`

- [ ] **Step 1: Add to authRoute**

In `apps/backend/src/routes/auth.ts`, append to the `authRoute` chain:

```ts
.post('/refresh', async (c) => {
  const body = await c.req.json<{ refreshToken: string; userId: string; role: 'principal' | 'agent' }>();
  if (!body.refreshToken || !body.userId || !body.role) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const r = await sessionService.refresh(db, body.refreshToken, body.role, body.userId);
  if (r.kind !== 'rotated') return c.json({ error: r.kind }, 401);
  return c.json({
    accessToken: r.tokens.accessToken,
    refreshToken: r.tokens.refreshToken,
    accessExpiresAt: r.tokens.accessExpiresAt.toISOString(),
    refreshExpiresAt: r.tokens.refreshExpiresAt.toISOString(),
  }, 200);
});

export const logoutRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/auth/logout', async (c) => {
    const a = c.get('actor');
    await sessionService.revoke(db, a.sessionId);
    return c.json({ revoked: true }, 200);
  });
```

(Refresh takes userId + role explicitly because the access token is gone by the time the client refreshes — clients store userId + role alongside tokens locally. An alternative is to look up the session by trying every active session in the DB, but that's an unbounded scan. Trade-off: refresh is unauthenticated against the access token by design, so client *must* pair refreshToken with the userId+role it knows. A malicious actor with only a refreshToken cannot impersonate without also knowing the userId.)

- [ ] **Step 2: Mount logout**

In `apps/backend/src/server.ts`, add:

```ts
import { logoutRoute } from './routes/auth';
// ...
app.route('/', logoutRoute);
```

- [ ] **Step 3: Tests** — append to `apps/backend/tests/routes/auth.test.ts`:

```ts
import { sessionService } from '../../src/modules/auth/session.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { factories } from '../helpers/factories';

describe('POST /auth/refresh', () => {
  beforeEach(async () => { await truncateAll(); });

  it('rotates and returns new tokens', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const first = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const app = createServer();
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: first.refreshToken,
        userId: u.id,
        role: 'principal',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { accessToken: string; refreshToken: string };
    expect(body.refreshToken).not.toBe(first.refreshToken);
  });

  it('401 invalid on bogus refresh', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: 'bogus', userId: u.id, role: 'principal',
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  beforeEach(async () => { await truncateAll(); });

  it('revokes the session, subsequent /me returns 401', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const app = createServer();
    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(200);
    const me = await app.request('/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.status).toBe(401);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/auth.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/auth.ts apps/backend/src/server.ts apps/backend/tests/routes/auth.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): POST /auth/refresh + POST /auth/logout"
```

---

### Task 17: POST /pairing (principal-only) + POST /pairing/consume

**Files:**
- Create: `apps/backend/src/routes/pairing.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/pairing.test.ts`

- [ ] **Step 1: Route**

```ts
// apps/backend/src/routes/pairing.ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { jwtAuth, type ActorVariables } from '../middleware/jwt-auth';
import { pairingService } from '../modules/auth/pairing.service';
import { householdsRepo } from '../modules/identity/households.repo';

export const pairingRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const body = await c.req.json<{ householdId: string }>();
    const hh = await householdsRepo.findById(db, body.householdId);
    if (!hh) return c.json({ error: 'household_not_found' }, 404);
    if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
    const t = await pairingService.issue(db, {
      principalUserId: a.userId, householdId: body.householdId,
    });
    return c.json({
      pairingTokenId: t.id,
      code: t.code,
      expiresAt: t.expiresAt.toISOString(),
    }, 201);
  });
```

- [ ] **Step 2: If `householdsRepo.findById` is missing**, add it to `apps/backend/src/modules/identity/households.repo.ts`:

```ts
async findById(db: DbOrTx, id: string): Promise<HouseholdRow | undefined> {
  const [row] = await db.select().from(households).where(eq(households.id, id)).limit(1);
  return row;
},
```

- [ ] **Step 3: Mount**

In `apps/backend/src/server.ts`:

```ts
import { pairingRoute } from './routes/pairing';
// ...
app.route('/pairing', pairingRoute);
```

(The agent-side consume happens inside `/auth/otp/verify` via the `pairingCode` field — no separate consume route needed at HTTP. This keeps the agent's onboarding atomic: one OTP-verify call signs them up + pairs them.)

- [ ] **Step 4: Test**

```ts
// apps/backend/tests/routes/pairing.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionService } from '../../src/modules/auth/session.service';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /pairing', () => {
  beforeEach(async () => { await truncateAll(); });

  it('principal can issue a pairing code for their own household', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id, name: 'HH',
    });
    const tokens = await sessionService.issue(testDb, { userId: principal.id, role: 'principal' });
    const app = createServer();
    const res = await app.request('/pairing', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ householdId: hh.id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { code: string };
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('agent gets 403 principal_only', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id, name: 'HH',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const tokens = await sessionService.issue(testDb, { userId: agent.id, role: 'agent' });
    const app = createServer();
    const res = await app.request('/pairing', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ householdId: hh.id }),
    });
    expect(res.status).toBe(403);
  });

  it('principal pairing another principals household → 403 not_your_household', async () => {
    const principalA = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const principalB = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hhB = await householdsRepo.insert(testDb, {
      principalUserId: principalB.id, name: 'HHB',
    });
    const tokens = await sessionService.issue(testDb, { userId: principalA.id, role: 'principal' });
    const app = createServer();
    const res = await app.request('/pairing', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ householdId: hhB.id }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/pairing.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/pairing.ts apps/backend/src/server.ts apps/backend/src/modules/identity/households.repo.ts apps/backend/tests/routes/pairing.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): POST /pairing (principal-only) — agent consume happens inline in otp/verify"
```

---

### Task 18: Auth module barrel

**Files:**
- Create: `apps/backend/src/modules/auth/index.ts`
- Modify: `apps/backend/src/modules/index.ts`

- [ ] **Step 1: Barrel**

```ts
// apps/backend/src/modules/auth/index.ts
export type * from './types';
export { otpChallengesRepo } from './otp-challenges.repo';
export { authSessionsRepo } from './auth-sessions.repo';
export { pairingTokensRepo } from './pairing-tokens.repo';
export { otpService } from './otp.service';
export { sessionService } from './session.service';
export { pairingService } from './pairing.service';
export {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyRefreshToken,
} from './tokens';
export { generateOtpCode, hashCode, verifyCode } from './codes';
```

- [ ] **Step 2: Top-level re-export**

In `apps/backend/src/modules/index.ts`, append:

```ts
export * as auth from './auth';
```

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/auth/index.ts apps/backend/src/modules/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): module barrel + top-level re-export"
```

---

## Phase H — Migrate routes off `actor()` (Tasks 19-22)

### Task 19: Swap middleware in all protected routes

**Files modified:**
- `apps/backend/src/routes/devices.ts`
- `apps/backend/src/routes/notification-prefs.ts`
- `apps/backend/src/routes/notifications.ts`
- `apps/backend/src/routes/transactions.ts`
- `apps/backend/src/routes/bumps.ts`
- `apps/backend/src/routes/vendors.ts`

For each file, do a mechanical 2-line edit:
1. Change the import from `from '../middleware/actor'` to `from '../middleware/jwt-auth'`.
2. Replace `actor()` with `jwtAuth()` in the `.use(...)` call.

The `Actor` and `ActorVariables` types in `jwt-auth.ts` are deliberately a superset (added `sessionId`) — existing routes that only read `userId` + `role` keep working unchanged.

- [ ] **Step 1: One file at a time** — for each of the 6 routes, apply the swap. After each, run that route's tests and confirm they fail with the expected error: missing bearer (401). Tests will be migrated to `bearerHeaders` in Task 20.

(They will fail. That's the point. Until T20 migrates them, the auth migration is half-done.)

- [ ] **Step 2: Commit each route swap together** — single commit:

```bash
cd "C:/Users/alex_/amana"
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/devices.ts apps/backend/src/routes/notification-prefs.ts apps/backend/src/routes/notifications.ts apps/backend/src/routes/transactions.ts apps/backend/src/routes/bumps.ts apps/backend/src/routes/vendors.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): swap actor() → jwtAuth() across all protected routes (tests broken until T20 migrates them)"
```

---

### Task 20: Migrate existing tests to `bearerHeaders`

**Files modified (~20 test files):**
- All files matching `apps/backend/tests/routes/*.test.ts`
- `apps/backend/tests/routes/e2e-spend.test.ts`
- `apps/backend/tests/routes/e2e-bump-notification.test.ts`

Replacement pattern. Find every:

```ts
'x-actor-user-id': someUserId,
'x-actor-role': 'principal',
```

Replace with usage of the helper:

```ts
const headers = await bearerHeaders(someUser);
// then in the request:
headers,
```

Practical workflow:
1. Pick one test file.
2. Add `import { bearerHeaders } from '../helpers/bearer';` at the top.
3. Find every `app.request(...)` that uses `'x-actor-user-id'` / `'x-actor-role'` headers.
4. Refactor: split out a `headers` const above the call so the same headers can include `'content-type'` etc.
5. Run that test file. All tests in it should pass.
6. Move to the next file.

The cost is mechanical but real (≈20 files). Don't skip the per-file run — biome may flag formatting on a file that compiles in isolation but fails the suite-wide format pass.

- [ ] **Step 1-N: One commit per route group**

Group commits by feature area to keep history navigable:

```bash
git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/devices.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): migrate devices to bearerHeaders"

git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/notification-prefs.test.ts apps/backend/tests/routes/notifications.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): migrate notification-prefs + notifications to bearerHeaders"

git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/transactions*.test.ts apps/backend/tests/routes/bumps.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): migrate transactions + bumps to bearerHeaders"

git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/vendors*.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): migrate vendors to bearerHeaders"

git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/e2e-spend.test.ts apps/backend/tests/routes/e2e-bump-notification.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): migrate e2e tests to bearerHeaders"
```

- [ ] **Step N+1: Run the full route suite** to confirm:

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes
```

All tests must pass.

---

### Task 21: Delete `middleware/actor.ts`

**Files:**
- Delete: `apps/backend/src/middleware/actor.ts`

- [ ] **Step 1: Confirm zero references**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend exec tsc --noEmit 2>&1 | tail -20
```

Then a grep:

```bash
git -C "C:/Users/alex_/amana" grep -n "from '.*middleware/actor'" -- "apps/backend/src" "apps/backend/tests"
```

Expected: zero hits.

- [ ] **Step 2: Delete + commit**

```bash
cd "C:/Users/alex_/amana"
git -C "C:/Users/alex_/amana" rm apps/backend/src/middleware/actor.ts
git -C "C:/Users/alex_/amana" commit -m "feat(auth): delete x-actor-* middleware (replaced by jwtAuth)"
```

---

### Task 22: Update health route + webhooks to NOT auth (sanity)

The webhook route is HMAC-verified, not actor-authed. The health route is unauthenticated by design. Confirm neither was accidentally swept up in Task 19.

- [ ] **Step 1: Sanity grep**

```bash
git -C "C:/Users/alex_/amana" grep -n "jwtAuth\|actor" -- "apps/backend/src/routes/webhooks*.ts" "apps/backend/src/routes/health*.ts"
```

Expected: zero hits.

- [ ] **Step 2: If hits exist**, remove them. Webhooks must stay HMAC-only. Health must stay open.

- [ ] **Step 3: No commit needed** if grep is clean.

---

## Phase I — Sweep + tag (Tasks 23-25)

### Task 23: README + CLAUDE.md update for auth

**Files:**
- Modify: `apps/backend/README.md`

- [ ] **Step 1: Update the Public HTTP routes section** to show:

```markdown
- `POST /auth/otp/request` — body: `{phone, purpose: 'login' | 'pair'}` → `{challengeId, expiresAt}`
- `POST /auth/otp/verify` — body: `{phone, code, pairingCode?, nin?, bvn?}` → `{accessToken, refreshToken, ..., user}`
- `POST /auth/refresh` — body: `{refreshToken, userId, role}` → `{accessToken, refreshToken, ...}`
- `POST /auth/logout` — bearer required → revokes session
- `GET  /me` — bearer required → returns the authed user
- `POST /pairing` — bearer required (principal-only) → issues a pairing code for an agent to consume on /auth/otp/verify
```

Replace the line about `x-actor-*` with: "All routes (except `/health` and `/webhooks/*`) require a `Bearer <accessToken>` header from `/auth/otp/verify` or `/auth/refresh`."

- [ ] **Step 2: Add a "Modules" entry** for `modules/auth`:

```markdown
- `modules/auth` — phone OTP (Termii SMS) + JWT access (HS256, 5min TTL) + opaque refresh tokens (argon2id, 30day TTL, rotation on refresh) + pairing tokens for agent onboarding.
```

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/README.md
git -C "C:/Users/alex_/amana" commit -m "docs(backend): document auth surface (OTP + JWT + pairing)"
```

---

### Task 24: Full sweep

Identical to Sub-plan 5 T28. Fresh DB rebuild + all checks.

- [ ] **Step 1: Clean DB**

```bash
cd "C:/Users/alex_/amana"
docker compose down -v
docker compose up -d
# Wait until Postgres is ready (db:migrate retries until success or 5 attempts)
pnpm --filter @amana/backend db:migrate
```

- [ ] **Step 2: Build / lint / typecheck / test**

```bash
cd "C:/Users/alex_/amana"
pnpm build
pnpm exec biome check .
pnpm typecheck
pnpm --filter @amana/backend test
```

Expected: ≥ 350 tests passing (323 from Sub-plan 5 + ~30 new from Sub-plan 6a). 0 failures. 1 skipped (sandbox smoke).

- [ ] **Step 3: Stop docker**

```bash
docker compose down
```

If biome flags mechanical issues, run `pnpm exec biome check --write .` (NOT `--unsafe`) and commit as `style: ...`.

---

### Task 25: Push + tag v0.0.6a-auth

- [ ] **Step 1: Push + tag**

```bash
cd "C:/Users/alex_/amana"
git -C "C:/Users/alex_/amana" push origin main
git -C "C:/Users/alex_/amana" tag -a v0.0.6a-auth -m "Sub-plan 6a complete: phone OTP + JWT + pairing — replaces x-actor-* placeholder"
git -C "C:/Users/alex_/amana" push origin v0.0.6a-auth
```

- [ ] **Step 2: Verify CI green** at https://github.com/Alexander77063/amana/actions.

---

## Plan complete

When all 25 tasks land green:

- `x-actor-*` placeholder middleware is gone. Every protected route requires a real Bearer token.
- Phone OTP via Termii (with no-key dev skip) → JWT access + refresh.
- Pairing-token flow for agent onboarding wired end-to-end (issue from principal /pairing → consume inside agent /auth/otp/verify).
- Sub-plan 6b (Principal mobile app) and 6c (Agent mobile app) build against this real auth.

## Out-of-scope follow-ups for later sub-plans

- KYC tier-2 upgrade flow: BVN verification via Anchor, address proof, tier_2 attestation. Currently every new user signs up at tier_1 — Sub-plan 6 mobile flows will gate spend on real tier_2 upgrade.
- TOTP / WebAuthn second factor for principal accounts.
- Device-binding refresh tokens (today's refresh is per-session, not per-device).
- Rate limit OTP requests per phone (today's limit is one *active* challenge per phone — but a phone can request a new one immediately after the prior one expires/consumes).
- Background reaper for expired sessions and pairing tokens (today they linger as inert rows).
