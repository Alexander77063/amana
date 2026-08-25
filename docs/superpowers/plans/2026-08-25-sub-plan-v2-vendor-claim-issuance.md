# Sub-plan V2 — Vendor Claim Rail & Code Issuance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a vendor prove they own a bank account already in the registry, claim their entry, choose an authoritative category, and receive a human-typable Amana Vendor Code — and give ops the controls to switch category enforcement on household by household.

**Architecture:** A vendor submits phone + account on a public, rate-limited surface. If (and only if) that account is a promoted `observed` vendor, we open a claim attempt and send a Termii OTP. Ownership is proved by two independent facts: the OTP proves phone control, and Anchor's NIBSS phone lookup resolving to the *same* account proves the phone and the account share a BVN. On success the vendor moves to `claimed`, its category becomes `claimed`-sourced and therefore enforceable, and a Crockford base32 code is minted. Ops gets a manual-approval path and the per-household enforcement switch.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Postgres 16, Zod, Termii (existing `otpService`), Anchor (existing `phoneLookupService`), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-25-vendor-registry-design.md` (§7, §8.2)
**Depends on:** `docs/superpowers/plans/2026-08-25-sub-plan-v1-vendor-registry-shadow.md` — must be merged first. Every interface consumed below is declared in a V1 task's **Produces** block.

## Global Constraints

- Repos and services take `db` as their **first argument**; routes live in `apps/backend/src/routes/`.
- Biome: single quotes, 2-space indent, 100-column line width.
- Validate every mutating route through `lib/validate.ts` — never raw `c.req.json()`.
- **Raw SQL in tests goes through drizzle's `sql` tag** — `sql\`… WHERE id = ${id}\``, never a template
  string interpolated into `db.execute(… as never)`. The `as never` form defeats drizzle's typing and
  builds the statement by string concatenation; parameters belong in the tag. Import `sql` from
  `drizzle-orm` in any test file that needs it.
- **The claim surface must never reveal whether an account is in the registry.** Identical status and body for registered and unregistered accounts. This is a spec requirement (§7.2), not a nicety: the endpoint would otherwise be an oracle for "has this account been paid by ≥5 Amana households".
- Every public endpoint added here is rate-limited in `attachRateLimiters`. An unrated OTP route is an SMS bill and an enumeration oracle.
- Ops endpoints sit behind `adminAuth(process.env.ADMIN_API_KEY)`. An unset key means **deny**, never open.
- No money moves in this sub-plan. See the scope note below.
- Coverage gate: lines/statements 92, functions 90, branches 80.

## Scope note — micro-deposit verification is deferred

Spec §7.1 lists a micro-deposit as the fallback when phone-lookup does not match, typically for business accounts not linked to the claimant's BVN-registered phone. **This plan does not implement it**, and the deferral is deliberate rather than an omission: a micro-deposit is an outbound NIP transfer, which means a funding source, a reconciliation path, a refund path, and a new failure mode on a surface that is otherwise read-only. Bundling a money movement into the claim rail would make this sub-plan the riskiest in the arc for the sake of a minority path.

What ships instead: phone-lookup match as the primary proof, and **ops manual approval** (Task 7) as the covering path for every vendor it cannot verify. That is a complete claim rail — some claims simply route through a human. Micro-deposit becomes SP-V2b if the ops queue proves too large to be worth a person's time; the queue depth is the trigger, and Task 8's runbook says how to read it.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/crockford.ts` | Shared unambiguous base32 alphabet and random generator |
| `src/db/schema/vendor-claims.ts` | `vendor_claim_attempts` table |
| `src/modules/vendors/vendor-claims.repo.ts` | Drizzle for the claim-attempt table only |
| `src/modules/vendors/vendor-ownership.service.ts` | Phone-lookup ownership proof. Pure orchestration over Anchor |
| `src/modules/vendors/vendor-claim.service.ts` | Request/verify state machine and code minting |
| `src/routes/vendor-claim.ts` | Public, unauthenticated, rate-limited claim surface |
| `src/routes/vendors-admin.ts` | Ops surface behind `adminAuth` |
| `docs/runbook/vendor-claim.md` | Operator runbook: the ops queue, the enforcement switch |

**Modified**

| File | Change |
|---|---|
| `src/modules/marketplace/codes.ts` | Delegate to `lib/crockford.ts`, keep the `AMN-` prefix |
| `src/db/schema/auth.ts` | Add `'vendor_claim'` to the `purpose` enum list |
| `src/modules/auth/types.ts` | Add `'vendor_claim'` to `OtpPurpose` |
| ~~`src/modules/auth/otp.service.ts`~~ | ~~Bind verification to the purpose~~ — **shipped already**, see Task 2b |
| ~~`src/routes/auth.ts`~~ | ~~Pass the purpose to `verifyCode`~~ — **shipped already**, see Task 2b |
| ~~`src/modules/marketplace/retailer-auth.service.ts`~~ | ~~Pass `'login'`~~ — **shipped already**, see Task 2b |
| `src/db/schema/index.ts` | Export `./vendor-claims` |
| `src/modules/vendors/vendors.repo.ts` | `claim`, `setOpsCategory`, `setStatus` |
| `src/modules/identity/households.repo.ts` | `setVendorCategoryEnforced` |
| `src/server.ts` | Mount both routes; rate-limit the public one |
| `src/env.ts` | `VENDOR_CLAIM_TTL_SECONDS` |
| `tests/helpers/test-db.ts` | Truncate `vendor_claim_attempts` |
| `CLAUDE.md` | Runbook index entry |

---

## Task 1: Shared Crockford alphabet and the vendor code

**Files:**
- Create: `apps/backend/src/lib/crockford.ts`
- Modify: `apps/backend/src/modules/marketplace/codes.ts`
- Test: `apps/backend/tests/lib/crockford.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `randomCrockford(len: number): string`, `CROCKFORD_ALPHABET: string`, `mintPrefixedCode(prefix: string): string`. `codes.ts` keeps exporting `mintCode()` unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/lib/crockford.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CROCKFORD_ALPHABET, mintPrefixedCode, randomCrockford } from '../../src/lib/crockford';
import { mintCode } from '../../src/modules/marketplace/codes';

describe('crockford', () => {
  it('excludes the four ambiguous glyphs', () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    for (const glyph of ['I', 'L', 'O', 'U']) {
      expect(CROCKFORD_ALPHABET).not.toContain(glyph);
    }
  });

  it('emits only alphabet symbols, at the requested length', () => {
    for (let i = 0; i < 200; i++) {
      const s = randomCrockford(5);
      expect(s).toHaveLength(5);
      for (const ch of s) expect(CROCKFORD_ALPHABET).toContain(ch);
    }
  });

  it('formats a prefixed code as PREFIX-XXXXX-XXXXX', () => {
    expect(mintPrefixedCode('AMNV')).toMatch(/^AMNV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('leaves the marketplace voucher format untouched', () => {
    expect(mintCode()).toMatch(/^AMN-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('does not repeat within a large batch', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => mintPrefixedCode('AMNV')));
    expect(seen.size).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/lib/crockford.test.ts`
Expected: FAIL — cannot resolve `src/lib/crockford`.

- [ ] **Step 3: Extract the shared module**

Create `apps/backend/src/lib/crockford.ts`:

```ts
import { randomBytes } from 'node:crypto';

/**
 * Crockford base32 with the ambiguous glyphs (I, L, O, U) removed — 32 symbols, so a random byte
 * masked with & 31 selects one with no modulo bias.
 *
 * Shared rather than duplicated: the marketplace mints voucher codes (`AMN-`) and the registry
 * mints vendor codes (`AMNV-`), and both are read aloud down a phone line by someone who must not
 * confuse a 1 for an I.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CODE_GROUP_LEN = 5;

export function randomCrockford(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CROCKFORD_ALPHABET.charAt((bytes[i] ?? 0) & 31);
  }
  return out;
}

/**
 * `PREFIX-XXXXX-XXXXX`. Two 5-symbol groups give 32^10 ≈ 1.1e15 of entropy — collisions across a
 * 10k batch are ~4e-8, and the caller's UNIQUE constraint is the authoritative dedup at write time.
 */
export function mintPrefixedCode(prefix: string): string {
  return `${prefix}-${randomCrockford(CODE_GROUP_LEN)}-${randomCrockford(CODE_GROUP_LEN)}`;
}
```

- [ ] **Step 4: Point marketplace at it**

In `apps/backend/src/modules/marketplace/codes.ts`, delete the local `CROCKFORD`, `CODE_GROUP_LEN` and `randomCrockford`, and replace `mintCode` with:

```ts
import { mintPrefixedCode } from '../../lib/crockford';

/**
 * Mint a human-typable single-use voucher code, e.g. `AMN-7QK2H-9PZ0R`. The DB `code` UNIQUE
 * constraint is the authoritative dedup at write time (the service retries on clash).
 */
export function mintCode(): string {
  return mintPrefixedCode('AMN');
}
```

Leave `qrSecret`, `mintQrToken` and `verifyQrToken` exactly as they are — they are marketplace redemption concerns and have nothing to do with the vendor code.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @amana/backend exec vitest run tests/lib/crockford.test.ts tests/modules/marketplace`
Expected: PASS — the new tests, and every existing marketplace code test unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lib/crockford.ts apps/backend/src/modules/marketplace/codes.ts apps/backend/tests/lib/crockford.test.ts
git commit -m "refactor(lib): share the Crockford alphabet between voucher and vendor codes"
```

---

## Task 2: Claim-attempt table and the new OTP purpose

**Files:**
- Create: `apps/backend/src/db/schema/vendor-claims.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Modify: `apps/backend/src/db/schema/auth.ts:11`
- Modify: `apps/backend/src/modules/auth/types.ts`
- Modify: `apps/backend/src/env.ts`
- Modify: `apps/backend/tests/helpers/test-db.ts`
- Test: `apps/backend/tests/db/vendor-claims-schema.test.ts`

**Interfaces:**
- Consumes: `vendors` (V1 Task 2).
- Produces: `vendorClaimAttempts`, `vendorClaimStatusEnum`; `OtpPurpose` gains `'vendor_claim'`; `env.VENDOR_CLAIM_TTL_SECONDS: number` (default 900).

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/db/vendor-claims-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorClaimAttempts } from '../../src/db/schema';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');

async function aVendor() {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

describe('vendor_claim_attempts schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('defaults a new attempt to pending', async () => {
    const v = await aVendor();
    await testDb.insert(vendorClaimAttempts).values({
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(NOW.getTime() + 900_000),
    });
    const [row] = await testDb.select().from(vendorClaimAttempts);
    expect(row?.status).toBe('pending');
    expect(row?.verifiedAt).toBeNull();
    expect(row?.ownershipProof).toBeNull();
  });

  it('allows only ONE pending attempt per vendor', async () => {
    const v = await aVendor();
    const attempt = {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(NOW.getTime() + 900_000),
    };
    await testDb.insert(vendorClaimAttempts).values(attempt);
    await expect(
      testDb.insert(vendorClaimAttempts).values({ ...attempt, phone: factories.phone() }),
    ).rejects.toThrow();
  });

  it('permits a second attempt once the first is no longer pending', async () => {
    const v = await aVendor();
    const [first] = await testDb
      .insert(vendorClaimAttempts)
      .values({ vendorId: v.id, phone: factories.phone(), expiresAt: NOW })
      .returning();
    if (!first) throw new Error('insert failed');
    await testDb.execute(
      sql`UPDATE vendor_claim_attempts SET status = 'expired' WHERE id = ${first.id}`,
    );
    await expect(
      testDb.insert(vendorClaimAttempts).values({
        vendorId: v.id,
        phone: factories.phone(),
        expiresAt: new Date(NOW.getTime() + 900_000),
      }),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/db/vendor-claims-schema.test.ts`
Expected: FAIL — `vendorClaimAttempts` is not exported from `src/db/schema`.

- [ ] **Step 3: Write the schema**

Create `apps/backend/src/db/schema/vendor-claims.ts`:

```ts
import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { vendors } from './vendors';

export const vendorClaimStatusEnum = pgEnum('vendor_claim_status', [
  'pending',
  'verified',
  'expired',
  'rejected',
]);

/**
 * One in-flight attempt by a phone number to claim one registry vendor.
 *
 * This exists because the OTP challenge is keyed by phone alone: something has to remember WHICH
 * account the phone said it was claiming between the request and the verify, and it must not be
 * the client — otherwise the verify step could redirect a legitimately-earned OTP at a different
 * vendor.
 */
export const vendorClaimAttempts = pgTable(
  'vendor_claim_attempts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    status: vendorClaimStatusEnum('status').notNull().default('pending'),
    // How ownership was established. Null while pending; 'phone_lookup' or 'ops' once verified.
    // Recorded because a vendor verified by a human is a different trust proposition from one
    // verified by NIBSS, and only the audit log would otherwise remember which.
    ownershipProof: text('ownership_proof'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // At most one pending attempt per vendor. A partial unique index rather than a plain one so
    // that the historical expired/rejected rows are unconstrained: without the WHERE clause a
    // vendor could never be retried after a failed claim.
    onePending: uniqueIndex('vendor_claim_attempts_one_pending')
      .on(t.vendorId)
      .where(sql`status = 'pending'`),
    phoneIdx: index('vendor_claim_attempts_phone_idx').on(t.phone),
  }),
);
```

- [ ] **Step 4: Extend the OTP purpose and add the TTL**

In `apps/backend/src/db/schema/auth.ts:11`:

```ts
    purpose: text('purpose', { enum: ['login', 'pair', 'vendor_claim'] }).notNull(),
```

> This column is Drizzle `text` with a **type-level** enum, not a Postgres enum, so the generated migration will contain no `ALTER TYPE`. Confirm that when you read the SQL in Step 5.

In `apps/backend/src/modules/auth/types.ts`:

```ts
export type OtpPurpose = 'login' | 'pair' | 'vendor_claim';
```

In `apps/backend/src/env.ts`, after the `VENDOR_*` block from V1:

```ts
  // How long a vendor has to enter the OTP that proves they control the claiming phone.
  // Longer than the 5-minute OTP TTL on purpose: a shopkeeper mid-service is not at their phone.
  VENDOR_CLAIM_TTL_SECONDS: z.coerce.number().int().positive().default(900),
```

In `apps/backend/src/db/schema/index.ts`, append `export * from './vendor-claims';`.

In `apps/backend/tests/helpers/test-db.ts`, add `'vendor_claim_attempts'` immediately **before** `'vendors'` in `TABLES_TO_TRUNCATE`.

- [ ] **Step 5: Generate and apply the migration**

```bash
pnpm --filter @amana/backend exec drizzle-kit generate
```

Read the generated SQL. Expect one `CREATE TYPE vendor_claim_status`, one `CREATE TABLE`, one `CREATE UNIQUE INDEX ... WHERE status = 'pending'`, one `CREATE INDEX`. Expect **no** change to `phone_otp_challenges`. If a `phone_otp_challenges` alter appears, stop — the purpose column is not what this plan assumed and the enum change needs its own handling.

```bash
pnpm --filter @amana/backend db:migrate
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/db/vendor-claims-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src apps/backend/tests
git commit -m "feat(vendors): claim-attempt table and the vendor_claim OTP purpose"
```

---

## Task 2b: OTP purpose binding — ALREADY SHIPPED, DO NOT IMPLEMENT

> **Status: done, ahead of this sub-plan.** Branch `fix/otp-purpose-binding`, PR #42, commits `1ac87fb` and `eeed18f`. If SP-V2 runs after that merges, **skip this task** — the work is in `main`.
>
> It was lifted out because it repairs a defect already live in `main` that had nothing to do with vendors: `otpService.verifyCode` returned a challenge's `purpose` and no caller checked it, so a `pair` OTP was a valid login credential at the retailer portal. Holding that behind a nine-task feature would have been the wrong call.
>
> **What shipped differs from what this task specified below — read this before Task 2 or Task 5.**
>
> The text below calls for a single required `purpose: OtpPurpose`. That is not what was built. `/auth/otp/verify` legitimately serves *both* login and pair in one endpoint; `VerifyOtpInput` carries no `purpose` (so requiring one is a breaking API change plus the api-client and both Expo apps); and deriving it from `pairingCode` misfires for an existing user sending a stray one. The shipped shape binds an **allowed set** instead:
>
> ```ts
> export type VerifyCodeInput = {
>   phone: string;
>   code: string;
>   /** The purposes this call site legitimately accepts. A challenge minted for anything else is refused. */
>   allowedPurposes: readonly OtpPurpose[];
> };
> ```
>
> `VerifyCodeResult` gained `{ kind: 'wrong_purpose' }`. `/auth/otp/verify` passes `['login', 'pair']`; the retailer portal passes `['login']`. The check sits **before** `claimAttempt`, so a mismatch does not burn one of the user's five attempts. Both call sites collapse `wrong_purpose` into their existing `invalid_code` / 401.
>
> **Consequences for the rest of SP-V2:**
>
> - **Task 2** still adds `'vendor_claim'` to `OtpPurpose` and the `phoneOtpChallenges.purpose` list. Nothing more — the value is now safe to add by construction, since no existing call site's allow-list includes it. Read the warning comment on `OtpPurpose`'s declaration first; it exists for this moment.
> - **Task 5** must pass `allowedPurposes: ['vendor_claim']`, **not** `purpose: 'vendor_claim'`. The claim rail accepts only its own challenges.
> - **A deliberate residual:** within `/auth/otp/verify`, `login` and `pair` stay interchangeable, because that endpoint serves both. The security review confirmed this is inert, not merely bounded — that handler never reads the verified challenge's `purpose` to branch. What the change closes is cross-endpoint reuse, the hazard SP-V2 would otherwise have created.

**Files:**
- Modify: `apps/backend/src/modules/auth/otp.service.ts`
- Modify: `apps/backend/src/routes/auth.ts:41`
- Modify: `apps/backend/src/modules/marketplace/retailer-auth.service.ts:52`
- Test: `apps/backend/tests/modules/auth/otp.service.test.ts` (append)

**Interfaces:**
- Consumes: `OtpPurpose` (Task 2).
- Produces: `VerifyCodeInput` gains a required `purpose: OtpPurpose`; `VerifyCodeResult` gains `{ kind: 'wrong_purpose' }`.

**Why this task exists, and why it is not optional.** `otpService.verifyCode` returns the challenge's `purpose`, and **no caller checks it**. Verified against the code: `routes/auth.ts:41` and `retailer-auth.service.ts:52` both accept any verified challenge for the phone. Today that means a `pair` OTP is a valid login credential and vice versa — a pre-existing gap, live in `main`, that this plan did not create.

Task 2 makes it worse. `requestCode` invalidates every active challenge for a phone before inserting a new one, so once `vendor_claim` exists, `POST /vendor-claim/request` becomes an unauthenticated endpoint that (a) can invalidate a legitimate in-flight login OTP for an arbitrary phone, and (b) mints a challenge that would satisfy `/auth/otp/verify` for that phone. Shipping V2 without this task turns a latent gap into a reachable one.

Fixing it by adding one `if` to the claim service would leave the other two callers unguarded. Making `purpose` a **required parameter** instead means the compiler names every call site, now and for whoever adds the fourth purpose.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/modules/auth/otp.service.test.ts`:

```ts
describe('purpose binding', () => {
  it('refuses a correct code issued for a different purpose', async () => {
    const phone = factories.phone();
    await otpService.requestCode(testDb, { phone, purpose: 'login' });
    const r = await otpService.verifyCode(testDb, {
      phone, code: BYPASS_CODE, purpose: 'vendor_claim',
    });
    expect(r.kind).toBe('wrong_purpose');
  });

  it('accepts a correct code for its own purpose', async () => {
    const phone = factories.phone();
    await otpService.requestCode(testDb, { phone, purpose: 'vendor_claim' });
    const r = await otpService.verifyCode(testDb, {
      phone, code: BYPASS_CODE, purpose: 'vendor_claim',
    });
    expect(r.kind).toBe('verified');
  });

  it('does NOT consume the challenge on a purpose mismatch', async () => {
    const phone = factories.phone();
    await otpService.requestCode(testDb, { phone, purpose: 'login' });
    await otpService.verifyCode(testDb, { phone, code: BYPASS_CODE, purpose: 'vendor_claim' });
    // The legitimate login must still work — a mismatched attempt is not the user's fault.
    const r = await otpService.verifyCode(testDb, { phone, code: BYPASS_CODE, purpose: 'login' });
    expect(r.kind).toBe('verified');
  });

  it('does not spend an attempt slot on a purpose mismatch', async () => {
    const phone = factories.phone();
    await otpService.requestCode(testDb, { phone, purpose: 'login' });
    for (let i = 0; i < 10; i++) {
      await otpService.verifyCode(testDb, { phone, code: BYPASS_CODE, purpose: 'vendor_claim' });
    }
    const r = await otpService.verifyCode(testDb, { phone, code: BYPASS_CODE, purpose: 'login' });
    expect(r.kind).toBe('verified');
  });
});
```

> `BYPASS_CODE` is whatever `DEV_OTP_BYPASS_CODE` the existing OTP tests set. Read the top of that file and reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/auth/otp.service.test.ts -t "purpose binding"`
Expected: FAIL — the first test gets `verified`, which is exactly the gap.

- [ ] **Step 3: Bind the purpose**

In `apps/backend/src/modules/auth/otp.service.ts`:

```ts
export type VerifyCodeInput = { phone: string; code: string; purpose: OtpPurpose };

export type VerifyCodeResult =
  | { kind: 'verified'; challengeId: string; purpose: OtpPurpose }
  | { kind: 'no_challenge' }
  | { kind: 'too_many_attempts' }
  | { kind: 'wrong_code' }
  | { kind: 'wrong_purpose' };
```

and in `verifyCode`, immediately after the `if (!ch) return { kind: 'no_challenge' }` line and **before** `claimAttempt`:

```ts
    // Purpose is bound, not merely reported. A challenge minted to claim a shop must not log
    // anyone in, and the reverse matters more: /vendor-claim/request is unauthenticated, so
    // without this an attacker could mint a login-capable challenge for any phone.
    //
    // Checked BEFORE claiming an attempt slot deliberately — a mismatch is a caller bug, not a
    // brute-force guess, and burning the user's real challenge over it would be a denial of
    // service triggerable from an unauthenticated endpoint.
    if (ch.purpose !== input.purpose) return { kind: 'wrong_purpose' as const };
```

- [ ] **Step 4: Fix the two existing call sites**

`apps/backend/src/routes/auth.ts:41` — pass the purpose the request asked for:

```ts
    const v = await otpService.verifyCode(db, {
      phone: body.phone,
      code: body.code,
      purpose: body.purpose,
    });
```

Confirm `body.purpose` exists on that route's verify schema; if the verify body does not carry it while the request body does, add it to the schema as a required field and update `packages/api-client/src/auth-api.ts` to send it. Handle `wrong_purpose` with the same response as `invalid_code` — a caller must not be told which of the two it was.

`apps/backend/src/modules/marketplace/retailer-auth.service.ts:52` — the portal only ever issues `login`:

```ts
    const v = await otpService.verifyCode(db, {
      phone: input.phone,
      code: input.code,
      purpose: 'login',
    });
```

Map `wrong_purpose` onto that service's existing `invalid_code` outcome.

- [ ] **Step 5: Run the full suite**

Run: `pnpm --filter @amana/backend test` and `pnpm --filter @amana/backend typecheck`
Expected: PASS. The typecheck is the point — it enumerates every `verifyCode` caller, including any this plan has not named.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src apps/backend/tests
git commit -m "fix(auth): bind OTP verification to the purpose the challenge was issued for"
```

---

## Task 3: Claim repository and vendor state transitions

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-claims.repo.ts`
- Modify: `apps/backend/src/modules/vendors/vendors.repo.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-claims.repo.test.ts`

**Interfaces:**
- Consumes: `vendorClaimAttempts` (Task 2), `vendorsRepo` (V1 Task 6).
- Produces:
  - `export type ClaimAttemptRow = typeof vendorClaimAttempts.$inferSelect`
  - `vendorClaimsRepo.openAttempt(db, { vendorId, phone, expiresAt }): Promise<ClaimAttemptRow | null>` — null when one is already pending
  - `vendorClaimsRepo.findPendingByPhone(db, phone, now): Promise<ClaimAttemptRow | undefined>`
  - `vendorClaimsRepo.markVerified(db, attemptId, proof: string, now): Promise<boolean>` — CAS from `pending`
  - `vendorClaimsRepo.expireOverdue(db, now): Promise<number>`
  - `vendorsRepo.claim(db, { vendorId, phone, category, publicCode, now }): Promise<VendorRow | null>` — CAS from `observed`
  - `vendorsRepo.setOpsCategory(db, vendorId, category): Promise<boolean>`
  - `vendorsRepo.setStatus(db, vendorId, status: 'observed' | 'claimed' | 'suspended'): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-claims.repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorClaimsRepo } from '../../../src/modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const LATER = new Date('2026-09-01T10:30:00Z');

async function aVendor() {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

describe('vendorClaimsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('opens one attempt and refuses a concurrent second', async () => {
    const v = await aVendor();
    const first = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id, phone: factories.phone(), expiresAt: LATER,
    });
    expect(first?.status).toBe('pending');
    const second = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id, phone: factories.phone(), expiresAt: LATER,
    });
    expect(second).toBeNull();
  });

  it('finds a pending attempt by phone, but not an expired one', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    await vendorClaimsRepo.openAttempt(testDb, { vendorId: v.id, phone, expiresAt: LATER });

    expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW)).toBeDefined();
    const past = new Date('2026-09-01T11:00:00Z');
    expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, past)).toBeUndefined();
  });

  it('marks verified exactly once', async () => {
    const v = await aVendor();
    const a = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id, phone: factories.phone(), expiresAt: LATER,
    });
    if (!a) throw new Error('open failed');
    expect(await vendorClaimsRepo.markVerified(testDb, a.id, 'phone_lookup', NOW)).toBe(true);
    expect(await vendorClaimsRepo.markVerified(testDb, a.id, 'phone_lookup', NOW)).toBe(false);
  });

  it('expires overdue pending attempts and leaves fresh ones alone', async () => {
    const v1 = await aVendor();
    const v2 = await aVendor();
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v1.id, phone: factories.phone(), expiresAt: NOW,
    });
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v2.id, phone: factories.phone(), expiresAt: new Date('2026-09-02T00:00:00Z'),
    });
    expect(await vendorClaimsRepo.expireOverdue(testDb, LATER)).toBe(1);
  });

  it('claims a vendor from observed and refuses a second claim', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    const claimed = await vendorsRepo.claim(testDb, {
      vendorId: v.id, phone, category: 'food', publicCode: 'AMNV-AAAAA-BBBBB', now: NOW,
    });
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.categorySource).toBe('claimed');
    expect(claimed?.category).toBe('food');
    expect(claimed?.publicCode).toBe('AMNV-AAAAA-BBBBB');
    expect(claimed?.claimedByPhone).toBe(phone);

    const again = await vendorsRepo.claim(testDb, {
      vendorId: v.id, phone: factories.phone(), category: 'transport',
      publicCode: 'AMNV-CCCCC-DDDDD', now: NOW,
    });
    expect(again).toBeNull();
  });

  it('lets ops set a category on a claimed vendor and suspend it', async () => {
    const v = await aVendor();
    await vendorsRepo.claim(testDb, {
      vendorId: v.id, phone: factories.phone(), category: 'food',
      publicCode: 'AMNV-EEEEE-FFFFF', now: NOW,
    });
    expect(await vendorsRepo.setOpsCategory(testDb, v.id, 'pharmacy')).toBe(true);
    const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(after?.category).toBe('pharmacy');
    expect(after?.categorySource).toBe('ops');

    expect(await vendorsRepo.setStatus(testDb, v.id, 'suspended')).toBe(true);
    const suspended = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(suspended?.status).toBe('suspended');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-claims.repo.test.ts`
Expected: FAIL — cannot resolve `vendor-claims.repo`.

- [ ] **Step 3: Write the claims repo**

Create `apps/backend/src/modules/vendors/vendor-claims.repo.ts`:

```ts
import { and, eq, gt, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorClaimAttempts } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ClaimAttemptRow = typeof vendorClaimAttempts.$inferSelect;

export const vendorClaimsRepo = {
  /**
   * Open a claim attempt, or return null if one is already pending for this vendor.
   *
   * The null comes from the partial unique index, not from a prior SELECT: two claim requests
   * arriving together must not both open an attempt, and only the index can promise that.
   */
  async openAttempt(
    db: DbOrTx,
    input: { vendorId: string; phone: string; expiresAt: Date },
  ): Promise<ClaimAttemptRow | null> {
    const [row] = await db
      .insert(vendorClaimAttempts)
      .values({ vendorId: input.vendorId, phone: input.phone, expiresAt: input.expiresAt })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  },

  async findPendingByPhone(
    db: DbOrTx,
    phone: string,
    now: Date,
  ): Promise<ClaimAttemptRow | undefined> {
    const [row] = await db
      .select()
      .from(vendorClaimAttempts)
      .where(
        and(
          eq(vendorClaimAttempts.phone, phone),
          eq(vendorClaimAttempts.status, 'pending'),
          gt(vendorClaimAttempts.expiresAt, now),
        ),
      )
      .limit(1);
    return row;
  },

  /** Compare-and-set from `pending`, so a replayed verify cannot re-verify an attempt. */
  async markVerified(db: DbOrTx, attemptId: string, proof: string, now: Date): Promise<boolean> {
    const changed = await db
      .update(vendorClaimAttempts)
      .set({ status: 'verified', ownershipProof: proof, verifiedAt: now })
      .where(and(eq(vendorClaimAttempts.id, attemptId), eq(vendorClaimAttempts.status, 'pending')))
      .returning({ id: vendorClaimAttempts.id });
    return changed.length > 0;
  },

  /**
   * Release the partial-unique slot held by attempts nobody completed, so the vendor can be
   * claimed again later. Called from the registry sweep.
   */
  async expireOverdue(db: DbOrTx, now: Date): Promise<number> {
    const changed = await db
      .update(vendorClaimAttempts)
      .set({ status: 'expired' })
      .where(
        and(eq(vendorClaimAttempts.status, 'pending'), lte(vendorClaimAttempts.expiresAt, now)),
      )
      .returning({ id: vendorClaimAttempts.id });
    return changed.length;
  },
};
```

- [ ] **Step 4: Add the vendor state transitions**

Append to `vendorsRepo` in `apps/backend/src/modules/vendors/vendors.repo.ts`:

```ts
  /**
   * Move a vendor from `observed` to `claimed`, in one atomic write.
   *
   * The `status = 'observed'` predicate is the compare-and-set that makes a claim single-use: a
   * second claim — a replay, or a race between two people who both control the phone — matches
   * nothing and returns null. Category and source move together with the status because a claimed
   * category that is still marked `observed` would silently fail to enforce.
   */
  async claim(
    db: DbOrTx,
    input: {
      vendorId: string;
      phone: string;
      category: string | null;
      publicCode: string;
      now: Date;
    },
  ): Promise<VendorRow | null> {
    const [row] = await db
      .update(vendors)
      .set({
        status: 'claimed',
        category: input.category,
        categorySource: 'claimed',
        categoryHouseholdCount: null,
        publicCode: input.publicCode,
        claimedByPhone: input.phone,
        claimedAt: input.now,
      })
      .where(and(eq(vendors.id, input.vendorId), eq(vendors.status, 'observed')))
      .returning();
    return row ?? null;
  },

  /** Ops override. Outranks a claimed category — an operator is correcting a business's own answer. */
  async setOpsCategory(db: DbOrTx, vendorId: string, category: string | null): Promise<boolean> {
    const changed = await db
      .update(vendors)
      .set({ category, categorySource: 'ops', categoryHouseholdCount: null })
      .where(eq(vendors.id, vendorId))
      .returning({ id: vendors.id });
    return changed.length > 0;
  },

  async setStatus(
    db: DbOrTx,
    vendorId: string,
    status: VendorRow['status'],
  ): Promise<boolean> {
    const changed = await db
      .update(vendors)
      .set({ status })
      .where(eq(vendors.id, vendorId))
      .returning({ id: vendors.id });
    return changed.length > 0;
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-claims.repo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/vendors apps/backend/tests/modules/vendors/vendor-claims.repo.test.ts
git commit -m "feat(vendors): claim attempts repo and CAS vendor state transitions"
```

---

## Task 4: Ownership proof

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-ownership.service.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-ownership.service.test.ts`

**Interfaces:**
- Consumes: `phoneLookupService.lookup(adapter, { phoneNumber })` (existing).
- Produces:
  - `export type OwnershipVerdict = { proved: true; proof: 'phone_lookup' } | { proved: false; reason: 'mismatch' | 'not_found' | 'partner_down' | 'bad_input' }`
  - `vendorOwnershipService.proveByPhoneLookup(adapter, { phone, bankCode, accountNumber }): Promise<OwnershipVerdict>`

**Why this is its own module:** the proof is one testable rule — *does NIBSS resolve this phone to this exact account* — and keeping it out of the claim state machine means it can be exercised without a database.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-ownership.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../src/lib/result';
import { phoneLookupService } from '../../../src/modules/vendors/phone-lookup.service';
import { vendorOwnershipService } from '../../../src/modules/vendors/vendor-ownership.service';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';

const adapter = {} as AnchorAdapter;
const TARGET = { phone: '+2348012345678', bankCode: '058', accountNumber: '0123456789' };

function mockLookup(bankCode: string, accountNumber: string) {
  return vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(
    ok({
      bankCode, accountNumber, accountName: 'MUSA ABDULLAHI',
      source: 'phone_lookup', suggestedAmountKobo: null,
    }),
  );
}

describe('vendorOwnershipService.proveByPhoneLookup', () => {
  it('proves ownership when NIBSS resolves the phone to the same account', async () => {
    const spy = mockLookup('058', '0123456789');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: true, proof: 'phone_lookup',
    });
    spy.mockRestore();
  });

  it('refuses when the account number differs', async () => {
    const spy = mockLookup('058', '9999999999');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false, reason: 'mismatch',
    });
    spy.mockRestore();
  });

  it('refuses when the bank differs even though the account number matches', async () => {
    const spy = mockLookup('011', '0123456789');
    expect(await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET)).toEqual({
      proved: false, reason: 'mismatch',
    });
    spy.mockRestore();
  });

  it('maps a NIBSS miss to not_found and an outage to partner_down', async () => {
    const miss = vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));
    expect((await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET))).toEqual({
      proved: false, reason: 'not_found',
    });
    miss.mockRestore();

    const down = vi
      .spyOn(phoneLookupService, 'lookup')
      .mockResolvedValue(err({ code: 'PARTNER_DOWN' }));
    expect((await vendorOwnershipService.proveByPhoneLookup(adapter, TARGET))).toEqual({
      proved: false, reason: 'partner_down',
    });
    down.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-ownership.service.test.ts`
Expected: FAIL — cannot resolve `vendor-ownership.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/modules/vendors/vendor-ownership.service.ts`:

```ts
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { isOk } from '../../lib/result';
import { phoneLookupService } from './phone-lookup.service';

export type OwnershipVerdict =
  | { proved: true; proof: 'phone_lookup' }
  | { proved: false; reason: 'mismatch' | 'not_found' | 'partner_down' | 'bad_input' };

export const vendorOwnershipService = {
  /**
   * Prove that a phone and a bank account belong to the same person.
   *
   * NIBSS phone lookup resolves a number to its primary BVN-linked account. If that comes back as
   * the very account being claimed, the phone and the account share a BVN — which, paired with an
   * OTP proving the claimant controls the phone, is a solid claim built entirely from calls the
   * platform already makes.
   *
   * Both the bank code and the account number must match. Account numbers are only ten digits and
   * are not unique across banks, so comparing the number alone would accept a different person's
   * account at a different institution.
   */
  async proveByPhoneLookup(
    adapter: AnchorAdapter,
    input: { phone: string; bankCode: string; accountNumber: string },
  ): Promise<OwnershipVerdict> {
    const r = await phoneLookupService.lookup(adapter, { phoneNumber: input.phone });
    if (!isOk(r)) {
      switch (r.error.code) {
        case 'NOT_FOUND':
          return { proved: false, reason: 'not_found' };
        case 'PARTNER_DOWN':
          return { proved: false, reason: 'partner_down' };
        default:
          return { proved: false, reason: 'bad_input' };
      }
    }
    const matches =
      r.value.bankCode === input.bankCode && r.value.accountNumber === input.accountNumber;
    return matches ? { proved: true, proof: 'phone_lookup' } : { proved: false, reason: 'mismatch' };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-ownership.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/vendors/vendor-ownership.service.ts apps/backend/tests/modules/vendors/vendor-ownership.service.test.ts
git commit -m "feat(vendors): phone-lookup ownership proof requiring bank AND account match"
```

---

## Task 5: Claim service

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-claim.service.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-claim.service.test.ts`

**Interfaces:**
- Consumes: `vendorsRepo` (Task 3), `vendorClaimsRepo` (Task 3), `vendorOwnershipService` (Task 4), `otpService` (existing), `mintPrefixedCode` (Task 1), `auditRepo` (existing).
- Produces:
  - `export type ClaimRequestResult = { accepted: boolean }` — **always `{ accepted: true }` to callers**; the boolean exists for tests and metrics
  - `vendorClaimService.request(db, adapter, { bankCode, accountNumber, phone, now }): Promise<ClaimRequestResult>`
  - `export type ClaimVerifyResult = { kind: 'claimed'; publicCode: string; displayName: string } | { kind: 'invalid_code' } | { kind: 'too_many_attempts' } | { kind: 'no_attempt' } | { kind: 'ownership_unproved'; reason: string } | { kind: 'partner_down' }`
  - `vendorClaimService.verify(db, adapter, { phone, code, category, now }): Promise<ClaimVerifyResult>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-claim.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { otpService } from '../../../src/modules/auth/otp.service';
import { vendorClaimService } from '../../../src/modules/vendors/vendor-claim.service';
import { vendorClaimsRepo } from '../../../src/modules/vendors/vendor-claims.repo';
import { vendorOwnershipService } from '../../../src/modules/vendors/vendor-ownership.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const adapter = {} as AnchorAdapter;

async function aPromotedVendor() {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

function proveOwnership(proved: boolean) {
  return vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue(
    proved ? { proved: true, proof: 'phone_lookup' } : { proved: false, reason: 'mismatch' },
  );
}

describe('vendorClaimService', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  describe('request', () => {
    it('opens an attempt and sends an OTP for a promoted vendor', async () => {
      const v = await aPromotedVendor();
      const phone = factories.phone();
      const otp = vi
        .spyOn(otpService, 'requestCode')
        .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

      const r = await vendorClaimService.request(testDb, adapter, {
        bankCode: v.bankCode, accountNumber: v.accountNumber, phone, now: NOW,
      });

      expect(r.accepted).toBe(true);
      expect(otp).toHaveBeenCalledWith(testDb, { phone, purpose: 'vendor_claim' });
      expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW)).toBeDefined();
    });

    it('sends NO OTP for an account that is not in the registry', async () => {
      const otp = vi.spyOn(otpService, 'requestCode');
      const r = await vendorClaimService.request(testDb, adapter, {
        bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
        phone: factories.phone(), now: NOW,
      });
      // The RESULT is indistinguishable from the success case — that is the non-oracle contract.
      expect(r.accepted).toBe(true);
      expect(otp).not.toHaveBeenCalled();
    });

    it('sends no OTP for a vendor that is already claimed', async () => {
      const v = await aPromotedVendor();
      await vendorsRepo.claim(testDb, {
        vendorId: v.id, phone: factories.phone(), category: 'food',
        publicCode: 'AMNV-AAAAA-BBBBB', now: NOW,
      });
      const otp = vi.spyOn(otpService, 'requestCode');

      const r = await vendorClaimService.request(testDb, adapter, {
        bankCode: v.bankCode, accountNumber: v.accountNumber,
        phone: factories.phone(), now: NOW,
      });
      expect(r.accepted).toBe(true);
      expect(otp).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    async function openAttempt(phone: string) {
      const v = await aPromotedVendor();
      vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
      await vendorClaimService.request(testDb, adapter, {
        bankCode: v.bankCode, accountNumber: v.accountNumber, phone, now: NOW,
      });
      return v;
    }

    it('claims the vendor and mints a code on a good OTP and a proved account', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified', challengeId: 'c1', purpose: 'vendor_claim',
      });
      proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone, code: '123456', category: 'food', now: NOW,
      });

      expect(r.kind).toBe('claimed');
      if (r.kind !== 'claimed') throw new Error('unreachable');
      expect(r.publicCode).toMatch(/^AMNV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);

      const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
      expect(after?.status).toBe('claimed');
      expect(after?.categorySource).toBe('claimed');
      expect(after?.category).toBe('food');
    });

    it('accepts a sensitive category from a claim — only inference is barred', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified', challengeId: 'c1', purpose: 'vendor_claim',
      });
      proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone, code: '123456', category: 'pharmacy', now: NOW,
      });
      expect(r.kind).toBe('claimed');
      const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
      expect(after?.category).toBe('pharmacy');
    });

    it('does not claim when the OTP is wrong', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
      const prove = proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone, code: '000000', category: 'food', now: NOW,
      });
      expect(r.kind).toBe('invalid_code');
      // Ownership must not even be attempted before the OTP passes — it is a paid Anchor call.
      expect(prove).not.toHaveBeenCalled();
      expect((await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber))?.status)
        .toBe('observed');
    });

    it('does not claim when ownership is unproved, even with a good OTP', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified', challengeId: 'c1', purpose: 'vendor_claim',
      });
      proveOwnership(false);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone, code: '123456', category: 'food', now: NOW,
      });
      expect(r.kind).toBe('ownership_unproved');
      expect((await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber))?.status)
        .toBe('observed');
    });

    it('does not claim on an OTP minted for a different purpose', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      // What a real login OTP looks like coming back from the purpose-bound verifyCode.
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_purpose' });
      const prove = proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone, code: '123456', category: 'food', now: NOW,
      });
      expect(r.kind).toBe('invalid_code');
      expect(prove).not.toHaveBeenCalled();
      expect((await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber))?.status)
        .toBe('observed');
    });

    it('returns no_attempt when the phone has no pending claim', async () => {
      const r = await vendorClaimService.verify(testDb, adapter, {
        phone: factories.phone(), code: '123456', category: 'food', now: NOW,
      });
      expect(r.kind).toBe('no_attempt');
    });

    it('audits every claim', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified', challengeId: 'c1', purpose: 'vendor_claim',
      });
      proveOwnership(true);
      await vendorClaimService.verify(testDb, adapter, {
        phone, code: '123456', category: 'food', now: NOW,
      });

      const entries = await auditRepo.listByAction(testDb, 'vendor.claimed');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.subjectId).toBe(v.id);
      const payload = entries[0]?.payloadJson as Record<string, unknown>;
      expect(payload.ownershipProof).toBe('phone_lookup');
      // The claimant's phone must not be echoed into the audit payload in the clear.
      expect(JSON.stringify(payload)).not.toContain(phone);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-claim.service.test.ts`
Expected: FAIL — cannot resolve `vendor-claim.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/modules/vendors/vendor-claim.service.ts`:

```ts
import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { mintPrefixedCode } from '../../lib/crockford';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { otpService } from '../auth/otp.service';
import { vendorClaimsRepo } from './vendor-claims.repo';
import { vendorOwnershipService } from './vendor-ownership.service';
import { vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export type ClaimRequestResult = { accepted: boolean };

export type ClaimVerifyResult =
  | { kind: 'claimed'; publicCode: string; displayName: string }
  | { kind: 'invalid_code' }
  | { kind: 'too_many_attempts' }
  | { kind: 'no_attempt' }
  | { kind: 'ownership_unproved'; reason: string }
  | { kind: 'partner_down' };

/** Last four digits only — enough to recognise a number in the audit log, useless if leaked. */
function phoneFingerprint(phone: string): string {
  const tail = phone.slice(-4);
  const digest = createHash('sha256').update(phone).digest('hex').slice(0, 8);
  return `***${tail}:${digest}`;
}

export const vendorClaimService = {
  /**
   * Begin a claim.
   *
   * **Always resolves `{ accepted: true }`, whatever happens.** A caller must not be able to learn
   * whether an account is in the registry, because that is precisely the aggregate the promotion
   * threshold exists to protect — "has this account been paid by at least five Amana households".
   * The work simply does not happen for an account we do not hold, and no OTP is sent.
   */
  async request(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: { bankCode: string; accountNumber: string; phone: string; now: Date },
  ): Promise<ClaimRequestResult> {
    try {
      const vendor = await vendorsRepo.findByAccount(db, input.bankCode, input.accountNumber);
      if (!vendor || vendor.status !== 'observed') return { accepted: true };

      const expiresAt = new Date(input.now.getTime() + env.VENDOR_CLAIM_TTL_SECONDS * 1000);
      const attempt = await vendorClaimsRepo.openAttempt(db, {
        vendorId: vendor.id,
        phone: input.phone,
        expiresAt,
      });
      // Null means someone else already has a claim in flight for this vendor. Same response.
      if (!attempt) return { accepted: true };

      await otpService.requestCode(db, { phone: input.phone, purpose: 'vendor_claim' });
      return { accepted: true };
    } catch (e) {
      // Even a failure is invisible to the caller — an error shape would itself be a signal.
      logger.warn({ err: (e as Error).message }, 'vendor claim request failed');
      return { accepted: true };
    }
  },

  /**
   * Complete a claim: OTP first, then ownership, then the state change.
   *
   * The order matters for cost as well as security — ownership proof is a paid Anchor call, so it
   * runs only after the OTP has established that the caller controls the phone.
   */
  async verify(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: { phone: string; code: string; category: string | null; now: Date },
  ): Promise<ClaimVerifyResult> {
    const attempt = await vendorClaimsRepo.findPendingByPhone(db, input.phone, input.now);
    if (!attempt) return { kind: 'no_attempt' };

    // `purpose` is required (Task 2b) — a login OTP must not complete a claim, and a claim OTP
    // must not complete a login. `wrong_purpose` falls into the same response as a wrong code:
    // the caller learns that it failed, not which of the two ways.
    const otp = await otpService.verifyCode(db, {
      phone: input.phone,
      code: input.code,
      allowedPurposes: ['vendor_claim'],
    });
    if (otp.kind === 'too_many_attempts') return { kind: 'too_many_attempts' };
    if (otp.kind !== 'verified') return { kind: 'invalid_code' };

    const vendor = await vendorsRepo.findById(db, attempt.vendorId);
    if (!vendor || vendor.status !== 'observed') return { kind: 'no_attempt' };

    const verdict = await vendorOwnershipService.proveByPhoneLookup(adapter, {
      phone: input.phone,
      bankCode: vendor.bankCode,
      accountNumber: vendor.accountNumber,
    });
    if (!verdict.proved) {
      if (verdict.reason === 'partner_down') return { kind: 'partner_down' };
      // The attempt stays pending so an ops operator can approve it by hand (Task 7). A refused
      // proof is the ops queue's inbox, not a dead end.
      return { kind: 'ownership_unproved', reason: verdict.reason };
    }

    const publicCode = mintPrefixedCode('AMNV');
    const claimed = await vendorsRepo.claim(db, {
      vendorId: vendor.id,
      phone: input.phone,
      category: input.category,
      publicCode,
      now: input.now,
    });
    if (!claimed) return { kind: 'no_attempt' };

    await vendorClaimsRepo.markVerified(db, attempt.id, verdict.proof, input.now);
    await auditRepo.append(db, {
      actorKind: 'system',
      action: 'vendor.claimed',
      subjectKind: 'vendor',
      subjectId: vendor.id,
      payloadJson: {
        // Fingerprinted, never the raw number: the audit log is queried far more widely than the
        // vendors table, and a claimant's phone is personal data that has no business spreading.
        claimantPhone: phoneFingerprint(input.phone),
        ownershipProof: verdict.proof,
        category: input.category,
        publicCode,
      },
    });

    return { kind: 'claimed', publicCode, displayName: claimed.displayName };
  },
};
```

- [ ] **Step 4: Add the missing repo lookup**

`vendorClaimService.verify` needs `vendorsRepo.findById`. Append it to `vendorsRepo` in `apps/backend/src/modules/vendors/vendors.repo.ts`:

```ts
  async findById(db: DbOrTx, vendorId: string): Promise<VendorRow | undefined> {
    const [row] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    return row;
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-claim.service.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/vendors apps/backend/tests/modules/vendors/vendor-claim.service.test.ts
git commit -m "feat(vendors): claim service — OTP then ownership then state change"
```

---

## Task 6: Public claim routes

**Files:**
- Create: `apps/backend/src/routes/vendor-claim.ts`
- Modify: `apps/backend/src/server.ts`
- Test: `apps/backend/tests/routes/vendor-claim.test.ts`

**Interfaces:**
- Consumes: `vendorClaimService` (Task 5).
- Produces: `vendorClaimRoute` mounted at `/vendor-claim`; `POST /vendor-claim/request`, `POST /vendor-claim/verify`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/routes/vendor-claim.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../../src/server';
import { otpService } from '../../src/modules/auth/otp.service';
import { vendorOwnershipService } from '../../src/modules/vendors/vendor-ownership.service';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const app = createServer();

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /vendor-claim', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('needs no authentication', async () => {
    const res = await post('/vendor-claim/request', {
      bankCode: '058', accountNumber: '0123456789', phone: '+2348012345678',
    });
    expect(res.status).not.toBe(401);
  });

  it('is a NON-ORACLE: byte-identical responses for registered and unregistered accounts', async () => {
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058', accountNumber: '0123456789',
      displayName: 'MAMA PUT', promotedHouseholdCount: 6, now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    const known = await post('/vendor-claim/request', {
      bankCode: '058', accountNumber: '0123456789', phone: '+2348012345678',
    });
    const unknown = await post('/vendor-claim/request', {
      bankCode: '058', accountNumber: '9999999999', phone: '+2348019999999',
    });

    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
  });

  it('400s a malformed phone rather than passing it downstream', async () => {
    const res = await post('/vendor-claim/request', {
      bankCode: '058', accountNumber: '0123456789', phone: 'not-a-phone',
    });
    expect(res.status).toBe(400);
  });

  it('returns the minted code on a successful verify', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058', accountNumber: '0123456789',
      displayName: 'MAMA PUT KITCHEN', promotedHouseholdCount: 6, now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058', accountNumber: '0123456789', phone: '+2348012345678',
    });
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified', challengeId: 'c1', purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: true, proof: 'phone_lookup',
    });

    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678', code: '123456', category: 'food',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicCode: string; displayName: string };
    expect(body.publicCode).toMatch(/^AMNV-/);
    expect(body.displayName).toBe('MAMA PUT KITCHEN');
  });

  it('401s a wrong code and 409s an unproved account', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058', accountNumber: '0123456789',
      displayName: 'MAMA PUT', promotedHouseholdCount: 6, now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058', accountNumber: '0123456789', phone: '+2348012345678',
    });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
    const bad = await post('/vendor-claim/verify', {
      phone: '+2348012345678', code: '000000', category: 'food',
    });
    expect(bad.status).toBe(401);

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified', challengeId: 'c1', purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: false, reason: 'mismatch',
    });
    const unproved = await post('/vendor-claim/verify', {
      phone: '+2348012345678', code: '123456', category: 'food',
    });
    expect(unproved.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendor-claim.test.ts`
Expected: FAIL — 404 on `/vendor-claim/request`.

- [ ] **Step 3: Write the route**

Create `apps/backend/src/routes/vendor-claim.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { parseBody } from '../lib/validate';
import { vendorClaimService } from '../modules/vendors/vendor-claim.service';

const PHONE_RE = /^\+\d{10,15}$/;

const RequestSchema = z.object({
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'invalid_account_number'),
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
});

const VerifySchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  code: z.string().min(1).max(10),
  category: z.string().min(1).max(64).nullable().default(null),
});

/**
 * The vendor claim rail. Mounted at `/vendor-claim`, deliberately unauthenticated — the claimant
 * is a shopkeeper who has never used Amana and has no account to sign in to.
 *
 * Both endpoints are rate-limited in `server.ts`. An unrated OTP route is an SMS bill; an unrated
 * claim route is a way to walk the registry.
 *
 * `/request` returns the SAME body and status whether or not the account is in the registry. That
 * is not defensive vagueness — a distinguishable response would turn this endpoint into an oracle
 * for "has this account been paid by at least five Amana households", which is exactly the
 * aggregate the promotion threshold exists to keep private.
 */
export const vendorClaimRoute = new Hono()
  .post('/request', async (c) => {
    const body = await parseBody(c, RequestSchema);
    if (body instanceof Response) return body;
    await vendorClaimService.request(db, anchorAdapterSingleton, { ...body, now: new Date() });
    return c.json({ status: 'pending_verification' }, 202);
  })
  .post('/verify', async (c) => {
    const body = await parseBody(c, VerifySchema);
    if (body instanceof Response) return body;
    const r = await vendorClaimService.verify(db, anchorAdapterSingleton, {
      phone: body.phone,
      code: body.code,
      category: body.category,
      now: new Date(),
    });

    switch (r.kind) {
      case 'claimed':
        return c.json({ publicCode: r.publicCode, displayName: r.displayName }, 200);
      case 'invalid_code':
        return c.json({ error: 'invalid_code' }, 401);
      case 'too_many_attempts':
        return c.json({ error: 'too_many_attempts' }, 401);
      case 'no_attempt':
        return c.json({ error: 'no_attempt' }, 404);
      case 'ownership_unproved':
        // 409, not 403: the caller proved they hold the phone. What failed is that NIBSS does not
        // link that phone to this account — a conflict with reality, and the ops queue's job now.
        return c.json({ error: 'ownership_unproved', detail: r.reason }, 409);
      case 'partner_down':
        return c.json({ error: 'anchor_unavailable' }, 503);
    }
  });
```

- [ ] **Step 4: Mount and rate-limit it**

In `apps/backend/src/server.ts`, inside `attachRateLimiters`, after the retailer OTP block:

```ts
  // The vendor claim rail is the second unauthenticated OTP surface. Same reasoning as the
  // retailer portal's, plus one more: an unrated /request is a way to walk the registry.
  for (const path of ['/vendor-claim/request', '/vendor-claim/verify']) {
    app.use(
      path,
      rateLimit({
        limit: env.RATE_LIMIT_OTP_PER_PHONE,
        windowSeconds,
        keyPrefix: `vendor-claim:phone:${path}`,
        key: bodyFieldKey('phone'),
      }),
    );
    app.use(
      path,
      rateLimit({
        limit: env.RATE_LIMIT_OTP_PER_IP,
        windowSeconds,
        keyPrefix: `vendor-claim:ip:${path}`,
        key: clientIp,
      }),
    );
  }
```

And with the other mounts:

```ts
  app.route('/vendor-claim', vendorClaimRoute);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendor-claim.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/vendor-claim.ts apps/backend/src/server.ts apps/backend/tests/routes/vendor-claim.test.ts
git commit -m "feat(vendors): public rate-limited claim rail with a non-oracle request endpoint"
```

---

## Task 7: Ops surface

**Files:**
- Create: `apps/backend/src/routes/vendors-admin.ts`
- Modify: `apps/backend/src/modules/identity/households.repo.ts`
- Modify: `apps/backend/src/server.ts`
- Modify: `apps/backend/src/cron/jobs/vendor-registry-sweep.job.ts`
- Test: `apps/backend/tests/routes/vendors-admin.test.ts`

**Interfaces:**
- Consumes: `vendorsRepo` (Task 3), `vendorClaimsRepo` (Task 3), `adminAuth` (existing).
- Produces: `vendorsAdminRoute` mounted at `/vendors-admin`, all behind `adminAuth`:
  - `GET /vendors-admin/claim-queue` — pending attempts whose automated proof failed
  - `POST /vendors-admin/vendors/:id/approve-claim` — manual ownership approval
  - `POST /vendors-admin/vendors/:id/category` — ops category override
  - `POST /vendors-admin/vendors/:id/suspend`
  - `POST /vendors-admin/households/:id/enforcement` — the shadow-mode switch
  - `householdsRepo.setVendorCategoryEnforced(db, householdId, value: boolean | null): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/routes/vendors-admin.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../src/server';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { factories } from '../helpers/factories';
import { makeHousehold } from '../helpers/fixtures';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const KEY = 'test-admin-key-that-is-at-least-32-chars';
const app = createServer();

function adminPost(path: string, body: unknown, key: string | null = KEY) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'x-admin-api-key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('/vendors-admin', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ADMIN_API_KEY = KEY;
  });

  it('401s without the admin key', async () => {
    const res = await adminPost('/vendors-admin/vendors/x/suspend', {}, null);
    expect(res.status).toBe(401);
  });

  it('401s when ADMIN_API_KEY is unset — an unconfigured admin surface must fail closed', async () => {
    process.env.ADMIN_API_KEY = undefined;
    const res = await adminPost('/vendors-admin/vendors/x/suspend', {});
    expect(res.status).toBe(401);
  });

  it('sets an ops category that outranks a claimed one', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
      displayName: 'SHOP', promotedHouseholdCount: 6, now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.claim(testDb, {
      vendorId: v.id, phone: factories.phone(), category: 'food',
      publicCode: 'AMNV-AAAAA-BBBBB', now: NOW,
    });

    const res = await adminPost(`/vendors-admin/vendors/${v.id}/category`, { category: 'transport' });
    expect(res.status).toBe(200);
    const after = await vendorsRepo.findById(testDb, v.id);
    expect(after?.category).toBe('transport');
    expect(after?.categorySource).toBe('ops');
  });

  it('400s a non-uuid vendor id rather than 500ing on the driver', async () => {
    const res = await adminPost('/vendors-admin/vendors/not-a-uuid/suspend', {});
    expect(res.status).toBe(400);
  });

  it('flips household enforcement on, off, and back to inherit', async () => {
    const { householdId } = await makeHousehold(testDb);

    for (const [value, expected] of [[true, true], [false, false], [null, null]] as const) {
      const res = await adminPost(`/vendors-admin/households/${householdId}/enforcement`, {
        enforced: value,
      });
      expect(res.status).toBe(200);
      const rows = await testDb.execute<{ vendor_category_enforced: boolean | null }>(
        sql`SELECT vendor_category_enforced FROM households WHERE id = ${householdId}`,
      );
      expect(rows[0]?.vendor_category_enforced).toBe(expected);
    }
  });

  it('404s enforcement for an unknown household', async () => {
    const res = await adminPost(`/vendors-admin/households/${factories.householdId()}/enforcement`, {
      enforced: true,
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendors-admin.test.ts`
Expected: FAIL — 404 on every path.

- [ ] **Step 3: Add the household setter**

Append to `householdsRepo` in `apps/backend/src/modules/identity/households.repo.ts`:

```ts
  /**
   * Set (or clear) a household's registry-enforcement override.
   *
   * `null` is a meaningful value, not a missing one: it means "inherit the global default", and it
   * is how a household is returned to the fleet-wide setting after being pinned either way.
   */
  async setVendorCategoryEnforced(
    db: DbOrTx,
    householdId: string,
    value: boolean | null,
  ): Promise<boolean> {
    const changed = await db
      .update(households)
      .set({ vendorCategoryEnforced: value })
      .where(eq(households.id, householdId))
      .returning({ id: households.id });
    return changed.length > 0;
  },
```

- [ ] **Step 4: Write the ops route**

Create `apps/backend/src/routes/vendors-admin.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody, parseParams } from '../lib/validate';
import { adminAuth } from '../middleware/admin-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { vendorClaimsRepo } from '../modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../modules/vendors/vendors.repo';
import { mintPrefixedCode } from '../lib/crockford';

const IdParams = z.object({ id: z.string().uuid() });
const CategoryBody = z.object({ category: z.string().min(1).max(64).nullable() });
const EnforcementBody = z.object({ enforced: z.boolean().nullable() });
const ApproveBody = z.object({ phone: z.string().min(1), category: z.string().min(1).max(64).nullable() });

/**
 * Ops controls for the vendor registry. Mounted at `/vendors-admin`, behind the shared
 * `x-admin-api-key`.
 *
 * Deliberately NOT `jwtAuth`, and deliberately a separate route file from `/vendors`: everything
 * here is an operator action on registry state, and none of it may ever touch a wallet, ledger or
 * transaction — those authorize by user identity against ownership, which a shared ops secret
 * cannot express. `ADMIN_API_KEY` unset means deny, so a misconfigured boot fails closed.
 */
export const vendorsAdminRoute = new Hono()
  .use('*', async (c, next) => adminAuth(process.env.ADMIN_API_KEY)(c, next))

  .get('/claim-queue', async (c) => {
    const rows = await vendorClaimsRepo.listPendingForOps(db, new Date());
    return c.json({ attempts: rows }, 200);
  })

  .post('/vendors/:id/approve-claim', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, ApproveBody);
    if (body instanceof Response) return body;

    const publicCode = mintPrefixedCode('AMNV');
    const claimed = await vendorsRepo.claim(db, {
      vendorId: params.id,
      phone: body.phone,
      category: body.category,
      publicCode,
      now: new Date(),
    });
    if (!claimed) return c.json({ error: 'not_claimable' }, 409);
    return c.json({ publicCode, displayName: claimed.displayName }, 200);
  })

  .post('/vendors/:id/category', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, CategoryBody);
    if (body instanceof Response) return body;
    const ok = await vendorsRepo.setOpsCategory(db, params.id, body.category);
    return ok ? c.json({ ok: true }, 200) : c.json({ error: 'not_found' }, 404);
  })

  .post('/vendors/:id/suspend', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const ok = await vendorsRepo.setStatus(db, params.id, 'suspended');
    return ok ? c.json({ ok: true }, 200) : c.json({ error: 'not_found' }, 404);
  })

  .post('/households/:id/enforcement', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, EnforcementBody);
    if (body instanceof Response) return body;
    const ok = await householdsRepo.setVendorCategoryEnforced(db, params.id, body.enforced);
    return ok ? c.json({ ok: true }, 200) : c.json({ error: 'not_found' }, 404);
  });
```

Add the ops listing to `vendorClaimsRepo`:

```ts
  /** Pending attempts an operator may need to approve by hand. Newest first. */
  async listPendingForOps(db: DbOrTx, now: Date): Promise<ClaimAttemptRow[]> {
    return db
      .select()
      .from(vendorClaimAttempts)
      .where(and(eq(vendorClaimAttempts.status, 'pending'), gt(vendorClaimAttempts.expiresAt, now)))
      .orderBy(desc(vendorClaimAttempts.createdAt))
      .limit(200);
  },
```

Add `desc` to the `drizzle-orm` import in that file.

Mount it in `apps/backend/src/server.ts` with the other routes:

```ts
  app.route('/vendors-admin', vendorsAdminRoute);
```

- [ ] **Step 5: Expire stale attempts on the sweep**

In `apps/backend/src/cron/jobs/vendor-registry-sweep.job.ts`, add the expiry call after the registry sweep so an abandoned claim releases its partial-unique slot:

```ts
    await vendorClaimsRepo.expireOverdue(db, new Date());
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendors-admin.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Run the full suite and the gates**

Run: `pnpm --filter @amana/backend test`, then `pnpm --filter @amana/backend test:coverage`, `pnpm exec biome check .`, `pnpm --filter @amana/backend typecheck`
Expected: all clean, coverage thresholds held.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src apps/backend/tests
git commit -m "feat(vendors): ops surface — claim queue, category override, enforcement switch"
```

---

## Task 8: Runbook

**Files:**
- Create: `docs/runbook/vendor-claim.md`
- Modify: `CLAUDE.md`
- Modify: `docs/runbook/vendor-registry.md` (cross-reference)

**Interfaces:** none.

- [ ] **Step 1: Write the runbook**

Create `docs/runbook/vendor-claim.md` covering, with real commands:

- The claim flow end to end, and **why `/request` always returns 202** — so nobody "fixes" it into a helpful 404 later. Say that outright; it is the single most likely well-meaning regression in this sub-plan.
- The two proofs and what each establishes: OTP → phone control; phone-lookup match → phone and account share a BVN. Neither alone is sufficient.
- **Working the ops queue** — `GET /vendors-admin/claim-queue`, when to approve by hand, and the fact that approving records `ownership_proof` as `ops` rather than `phone_lookup`, so the two trust levels stay distinguishable afterwards.
- **The queue-depth trigger:** if manual approvals become routine rather than exceptional, that is the signal to build SP-V2b micro-deposit verification. State the number that would count as routine, so the decision is not left to vibes.
- **Turning enforcement on:**

```bash
curl -X POST "$API/vendors-admin/households/<uuid>/enforcement" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"enforced": true}'
```

- Turning it off (`false`) versus returning it to the global default (`null`), and that these are different.
- The precondition: read the shadow data for that household first (query in `vendor-registry.md`) — nobody gets enforcement switched on without someone having looked at what it will change.
- Suspending a vendor, and that suspension makes its code resolve 410 for every payer (SP-V3).

- [ ] **Step 2: Index it**

Add `vendor-claim.md` to the `docs/runbook/` list in `CLAUDE.md`, and add a "see also" line to `docs/runbook/vendor-registry.md` pointing at it for the enforcement switch.

- [ ] **Step 3: Validate the tables**

Run: `py tools/docs/validate-tables.py`
Expected: all tables well-formed.

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: vendor claim runbook — ops queue and the enforcement switch"
```

---

## Self-Review

**Spec coverage.** §7.1 primary proof → Tasks 4–5; ops last resort → Task 7; micro-deposit → explicitly deferred with a stated trigger (scope note, Task 8). §7.2 non-oracle → Task 5's `request` contract and Task 6's byte-identical-response test. §7.3 state machine → Task 3's CAS transitions plus Task 7's suspend. §8.2 code minting and the `lib/crockford.ts` extraction → Task 1. The per-household enforcement switch the V1 spec describes as ops-driven → Task 7.

**Deliberately not here:** everything in SP-V3 — `kind: 'vendor'` resolution, `GET /vendors/code/:code`, the agent scan path, the landing page. A code minted by this sub-plan is storable and displayable but not yet scannable; that is the seam between V2 and V3, and it is why Task 6 returns the code to the claimant rather than assuming an app will fetch it.

**Placeholder scan.** No TBDs. `makeHousehold` in Task 7 reuses the V1 fixture. Task 8's runbook lists its required contents rather than its prose, which is the correct granularity for a document whose value is operational accuracy rather than exact wording — but every command in it is given in full.

**Type consistency.** `ClaimAttemptRow` is produced in Task 3 and consumed in Tasks 5 and 7. `OwnershipVerdict.proof` is `'phone_lookup'` in Task 4 and is what Task 5 passes to `markVerified`, whose parameter is `proof: string` — deliberately widened there because Task 7 writes `'ops'` through the same column. `vendorsRepo.claim` returns `VendorRow | null` in Task 3 and both callers (Tasks 5, 7) treat null as a 409-equivalent. `mintPrefixedCode` is defined in Task 1 and called in Tasks 5 and 7 with the same `'AMNV'` prefix.

**One pre-existing defect this plan now fixes.** Task 2b is not part of the vendor feature — it repairs a gap already live in `main`, where `verifyCode` reports a challenge's `purpose` and no caller checks it, making `login` and `pair` OTPs interchangeable. It sits in this plan because Task 2 is what makes the gap reachable from an unauthenticated endpoint, and shipping the one without the other would be knowingly widening it. If SP-V2 is descoped or deferred, **Task 2b should be lifted out and shipped on its own** rather than deferred with it.

**Two risks worth stating.** First, Task 7's `approve-claim` mints a code and claims a vendor on an operator's say-so with no proof recorded beyond `ownership_proof = 'ops'` — that is intentional, but it means the admin key is now a credential that can assign a business identity, and the runbook must say so. Second, `vendorsRepo.setOpsCategory` deliberately outranks a claimed category and has no CAS guard; an operator can overwrite a business's own answer about itself. Both are correct for an ops tool and both would be wrong if this route ever moved behind anything less than `adminAuth`.
