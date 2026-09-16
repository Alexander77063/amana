# Support Verification Implementation Plan (A1 Task 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a support operator verify that a caller controls the phone number they claim, then see masked operational data about that customer and nothing identifying, with every read audited against the verification.

**Architecture:** One new backend module (`modules/support/`) over one new table (`support_verifications`). The operator starts a verification; the server resolves the phone to a user, dispatches either a push (tap one of three numbers, the operator reads the match aloud) or an SMS code (read back to the operator), and records the outcome. A verified row opens a 15-minute read session that three read endpoints require. Two Expo apps gain an approve surface; the admin portal gains a `/support` area.

**Tech Stack:** Hono, Drizzle ORM, Postgres 16, Vitest against a real database, Zod, React Native / Expo, Next.js (admin portal), Biome.

**Spec:** [`docs/superpowers/specs/2026-09-16-support-verification-design.md`](../specs/2026-09-16-support-verification-design.md)

## Global Constraints

- **Verified callers are principals and agents only.** Retailers are out of scope.
- **Never reveal whether a customer exists.** `POST /admin/support/verifications` always returns `202` with a verification id and match number, whether or not the phone resolves to a user.
- **A rate-limit breach returns `429`, not `202`.** The no-oracle rule protects customer existence; an operator's own quota reveals nothing about that.
- **BVN and NIN are absent from every support response, not masked.** So are full name, address, date of birth, and full account number.
- **Push gets one attempt; SMS gets three.** A 1-in-3 guess must not be retryable.
- **Caps are counted in the database**, not in the in-memory `rateLimit` middleware.
- **Defaults:** pending window `180` seconds, verified session `900` seconds, `20` starts per operator per hour, `5` starts per phone per day (across all operators).
- **Every document a task falsifies is edited in that same task's commit.** Never as a follow-up.
- **Biome owns formatting and import order.** Run `pnpm exec biome check --write .` before committing; accept its ordering rather than the plan's.
- **Tests need a real database.** `docker compose up -d` before `pnpm --filter @amana/backend test`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/db/schema/support.ts` | The `support_verifications` table and its two enums |
| `apps/backend/src/db/migrations/0050_support_verifications.sql` | Forward-only migration |
| `apps/backend/src/modules/support/support-verifications.repo.ts` | Every query against the table. No policy |
| `apps/backend/src/modules/support/support-verification.service.ts` | Start, respond, confirm, and the session gate. All policy |
| `apps/backend/src/modules/support/support-read.service.ts` | The three read shapes, and what they omit |
| `apps/backend/src/modules/support/index.ts` | Barrel export |
| `apps/backend/src/routes/admin/support.ts` | Operator-facing routes, behind `adminSession()` |
| `apps/backend/src/routes/support-respond.ts` | The one customer-facing route, behind `jwtAuth()` |
| `apps/admin-portal/src/app/support/page.tsx` | The operator screen |
| `packages/api-client/src/support.ts` | Typed client for the customer respond call |
| `apps/principal/src/screens/SupportApproveScreen.tsx` | Principal approve surface |
| `apps/agent/src/screens/SupportApproveScreen.tsx` | Agent approve surface |

Policy lives in the service, never in a route — a check performed by a route is a check the next caller forgets. This mirrors `admin-iam.service`.

---

### Task 1: Schema, migration, and the documents it falsifies

**Files:**
- Create: `apps/backend/src/db/schema/support.ts`
- Create: `apps/backend/src/db/migrations/0050_support_verifications.sql`
- Modify: `apps/backend/src/db/schema/index.ts`
- Modify: `docs/product/database-schema.md`
- Modify: `docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md`
- Test: `apps/backend/tests/db/support-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `supportVerifications` table object; `supportVerificationStatusEnum` (`pending | verified | denied | expired`); `supportVerificationRailEnum` (`push | sms | none`); row type `typeof supportVerifications.$inferSelect`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/db/support-schema.test.ts
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { supportVerifications } from '../../src/db/schema';
import { testDb } from '../helpers/test-db';
import { truncateAll } from '../helpers/test-db';

describe('support_verifications', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('accepts a pending row with no resolved user', async () => {
    const [row] = await testDb
      .insert(supportVerifications)
      .values({
        adminUserId: null,
        phoneE164: '+2348010000001',
        userId: null,
        status: 'pending',
        rail: 'none',
        expiresAt: new Date(Date.now() + 180_000),
      })
      .returning();
    expect(row.status).toBe('pending');
    expect(row.userId).toBeNull();
    expect(row.attempts).toBe(0);
  });

  it('rejects a status outside the enum', async () => {
    await expect(
      testDb.execute(
        sql`insert into support_verifications (phone_e164, status, rail, expires_at)
            values ('+2348010000002', 'bogus', 'none', now())`,
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/db/support-schema.test.ts`
Expected: FAIL — `supportVerifications` is not exported from `../../src/db/schema`.

- [ ] **Step 3: Write the schema file**

```ts
// apps/backend/src/db/schema/support.ts
import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { users } from './identity';

export const supportVerificationStatusEnum = pgEnum('support_verification_status', [
  'pending',
  'verified',
  'denied',
  'expired',
]);

/** `none` is not an absence — it records that nothing was dispatched, because no user matched. */
export const supportVerificationRailEnum = pgEnum('support_verification_rail', [
  'push',
  'sms',
  'none',
]);

/**
 * One row per verification ATTEMPT, written whether or not the phone resolves to a customer.
 * That is deliberate: a row that only existed for real customers would make the table itself an
 * enumeration oracle, and the "no such customer" path has to be indistinguishable from an
 * unanswered call.
 *
 * This row is also the audit anchor. Every support read cites `id`, which is what makes "which
 * operator read this customer's data, under which verified session" answerable at all.
 */
export const supportVerifications = pgTable(
  'support_verifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Nullable only so the schema test can insert without a staff fixture; every production write
    // sets it. The service is what guarantees it, because an operator-less verification is
    // meaningless.
    adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
    phoneE164: text('phone_e164').notNull(),
    // Null when the number matched nobody. Never surfaced to the operator.
    userId: uuid('user_id').references(() => users.id),
    status: supportVerificationStatusEnum('status').notNull().default('pending'),
    rail: supportVerificationRailEnum('rail').notNull(),
    // Push rail: the number the operator reads aloud. 10-99.
    matchNumber: smallint('match_number'),
    // SMS rail: a hash, never the code. A support table that stored a readable code would hand
    // anyone with database access the ability to pass verification without the customer.
    codeHash: text('code_hash'),
    attempts: smallint('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
  },
  (t) => ({
    // The two cap queries: per operator in a window, per phone in a window.
    byOperatorCreated: index('support_verifications_admin_created_idx').on(t.adminUserId, t.createdAt),
    byPhoneCreated: index('support_verifications_phone_created_idx').on(t.phoneE164, t.createdAt),
  }),
);
```

- [ ] **Step 4: Write the migration**

```sql
-- apps/backend/src/db/migrations/0050_support_verifications.sql
CREATE TYPE "support_verification_status" AS ENUM ('pending', 'verified', 'denied', 'expired');
CREATE TYPE "support_verification_rail" AS ENUM ('push', 'sms', 'none');

CREATE TABLE "support_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid REFERENCES "admin_users"("id"),
  "phone_e164" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "status" "support_verification_status" DEFAULT 'pending' NOT NULL,
  "rail" "support_verification_rail" NOT NULL,
  "match_number" smallint,
  "code_hash" text,
  "attempts" smallint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "session_expires_at" timestamp with time zone
);

CREATE INDEX "support_verifications_admin_created_idx"
  ON "support_verifications" ("admin_user_id", "created_at");
CREATE INDEX "support_verifications_phone_created_idx"
  ON "support_verifications" ("phone_e164", "created_at");
```

- [ ] **Step 5: Export from the schema barrel**

Add to `apps/backend/src/db/schema/index.ts`, in the file's existing order (append after `'./admin'`):

```ts
export * from './support';
```

- [ ] **Step 6: Apply the migration and run the test**

Run: `pnpm --filter @amana/backend db:migrate && pnpm --filter @amana/backend exec vitest run tests/db/support-schema.test.ts`
Expected: PASS, both cases.

- [ ] **Step 7: Update the schema doc — the CI guard will fail the build without this**

`tools/docs/validate_schema_doc.py` is live on `main`. It will now measure 41 tables, 42 enums, 50 migrations against a document claiming 40/40/49.

In `docs/product/database-schema.md`:
1. Change the header claim to `**41 tables, 42 enums, 50 migrations.**`
2. Add to the "Tables by domain" lists, after the Admin & IAM line:

```markdown
**Support** (added 2026-09-16, sub-plan A1 Task 6) — `support_verifications`
```

3. Add a short subsection under the existing `### Admin & IAM` commentary explaining the nullable `user_id` and why the code is hashed.

- [ ] **Step 8: Correct the sub-plan section this supersedes**

In `docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md`, the Task 6 ASCII sketch shows a plain "Approve". Replace that line with the number-matching flow and add a pointer to the spec. Leaving it would be a document describing a design the code does not implement.

- [ ] **Step 9: Verify the guards and commit**

Run: `py -3 tools/docs/validate_schema_doc.py && py -3 tools/docs/validate-tables.py`
Expected: both exit 0, the first reporting `41 tables, 42 enums, 50 migrations`.

```bash
pnpm exec biome check --write .
git add apps/backend/src/db docs/product/database-schema.md docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md apps/backend/tests/db/support-schema.test.ts
git commit -m "feat(support): the verification table, written even when nobody matches"
```

---

### Task 2: The repository

**Files:**
- Create: `apps/backend/src/modules/support/support-verifications.repo.ts`
- Create: `apps/backend/src/modules/support/index.ts`
- Test: `apps/backend/tests/modules/support/support-verifications.repo.test.ts`

**Interfaces:**
- Consumes: `supportVerifications` from Task 1.
- Produces:

```ts
export type SupportVerificationRow = typeof supportVerifications.$inferSelect;
export type SupportRail = 'push' | 'sms' | 'none';

export const supportVerificationsRepo: {
  create(db: DbOrTx, input: {
    adminUserId: string;
    phoneE164: string;
    userId: string | null;
    rail: SupportRail;
    matchNumber: number | null;
    codeHash: string | null;
    expiresAt: Date;
  }): Promise<SupportVerificationRow>;
  findById(db: DbOrTx, id: string): Promise<SupportVerificationRow | null>;
  markVerified(db: DbOrTx, id: string, sessionExpiresAt: Date): Promise<SupportVerificationRow | null>;
  markDenied(db: DbOrTx, id: string): Promise<SupportVerificationRow | null>;
  incrementAttempts(db: DbOrTx, id: string): Promise<number>;
  countByOperatorSince(db: DbOrTx, adminUserId: string, since: Date): Promise<number>;
  countByPhoneSince(db: DbOrTx, phoneE164: string, since: Date): Promise<number>;
};
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/modules/support/support-verifications.repo.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { supportVerificationsRepo } from '../../../src/modules/support';
import { signedInAdmin } from '../../helpers/admin-session';
import { testDb, truncateAll } from '../../helpers/test-db';

const in3Min = () => new Date(Date.now() + 180_000);

describe('supportVerificationsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('counts starts by one operator inside the window and ignores older ones', async () => {
    const { adminUserId } = await signedInAdmin('support1@amana-ng.com', ['support']);
    await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: '+2348010000001',
      userId: null,
      rail: 'none',
      matchNumber: null,
      codeHash: null,
      expiresAt: in3Min(),
    });

    const sinceNow = await supportVerificationsRepo.countByOperatorSince(
      testDb,
      adminUserId,
      new Date(Date.now() - 60_000),
    );
    const sinceFuture = await supportVerificationsRepo.countByOperatorSince(
      testDb,
      adminUserId,
      new Date(Date.now() + 60_000),
    );

    expect(sinceNow).toBe(1);
    expect(sinceFuture).toBe(0);
  });

  it('counts starts against one phone regardless of which operator made them', async () => {
    const a = await signedInAdmin('support2@amana-ng.com', ['support']);
    const b = await signedInAdmin('support3@amana-ng.com', ['support']);
    for (const operator of [a, b]) {
      await supportVerificationsRepo.create(testDb, {
        adminUserId: operator.adminUserId,
        phoneE164: '+2348010000009',
        userId: null,
        rail: 'none',
        matchNumber: null,
        codeHash: null,
        expiresAt: in3Min(),
      });
    }

    const count = await supportVerificationsRepo.countByPhoneSince(
      testDb,
      '+2348010000009',
      new Date(Date.now() - 60_000),
    );

    expect(count).toBe(2);
  });

  it('increments attempts and returns the new value', async () => {
    const { adminUserId } = await signedInAdmin('support4@amana-ng.com', ['support']);
    const row = await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: '+2348010000003',
      userId: null,
      rail: 'sms',
      matchNumber: null,
      codeHash: 'hashed',
      expiresAt: in3Min(),
    });

    expect(await supportVerificationsRepo.incrementAttempts(testDb, row.id)).toBe(1);
    expect(await supportVerificationsRepo.incrementAttempts(testDb, row.id)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/support/support-verifications.repo.test.ts`
Expected: FAIL — cannot resolve `../../../src/modules/support`.

- [ ] **Step 3: Write the repository**

```ts
// apps/backend/src/modules/support/support-verifications.repo.ts
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { supportVerifications } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type SupportVerificationRow = typeof supportVerifications.$inferSelect;
export type SupportRail = 'push' | 'sms' | 'none';

export const supportVerificationsRepo = {
  async create(
    db: DbOrTx,
    input: {
      adminUserId: string;
      phoneE164: string;
      userId: string | null;
      rail: SupportRail;
      matchNumber: number | null;
      codeHash: string | null;
      expiresAt: Date;
    },
  ): Promise<SupportVerificationRow> {
    const [row] = await db.insert(supportVerifications).values(input).returning();
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<SupportVerificationRow | null> {
    const [row] = await db
      .select()
      .from(supportVerifications)
      .where(eq(supportVerifications.id, id))
      .limit(1);
    return row ?? null;
  },

  async markVerified(
    db: DbOrTx,
    id: string,
    sessionExpiresAt: Date,
  ): Promise<SupportVerificationRow | null> {
    // The `status = 'pending'` predicate is the concurrency guard: two responses racing must not
    // both verify, and a denied row must never be resurrected.
    const [row] = await db
      .update(supportVerifications)
      .set({ status: 'verified', verifiedAt: new Date(), sessionExpiresAt })
      .where(and(eq(supportVerifications.id, id), eq(supportVerifications.status, 'pending')))
      .returning();
    return row ?? null;
  },

  async markDenied(db: DbOrTx, id: string): Promise<SupportVerificationRow | null> {
    const [row] = await db
      .update(supportVerifications)
      .set({ status: 'denied' })
      .where(and(eq(supportVerifications.id, id), eq(supportVerifications.status, 'pending')))
      .returning();
    return row ?? null;
  },

  async incrementAttempts(db: DbOrTx, id: string): Promise<number> {
    const [row] = await db
      .update(supportVerifications)
      .set({ attempts: sql`${supportVerifications.attempts} + 1` })
      .where(eq(supportVerifications.id, id))
      .returning({ attempts: supportVerifications.attempts });
    return row?.attempts ?? 0;
  },

  async countByOperatorSince(db: DbOrTx, adminUserId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(supportVerifications)
      .where(
        and(
          eq(supportVerifications.adminUserId, adminUserId),
          gte(supportVerifications.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  },

  async countByPhoneSince(db: DbOrTx, phoneE164: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(supportVerifications)
      .where(
        and(
          eq(supportVerifications.phoneE164, phoneE164),
          gte(supportVerifications.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  },
};
```

```ts
// apps/backend/src/modules/support/index.ts
export {
  supportVerificationsRepo,
  type SupportRail,
  type SupportVerificationRow,
} from './support-verifications.repo';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/support/support-verifications.repo.test.ts`
Expected: PASS, three cases.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write .
git add apps/backend/src/modules/support apps/backend/tests/modules/support
git commit -m "feat(support): verification repo, with the two cap counts it exists to answer"
```

---

### Task 3: Starting a verification

**Files:**
- Create: `apps/backend/src/modules/support/support-verification.service.ts`
- Create: `apps/backend/src/modules/support/code-hash.ts`
- Modify: `apps/backend/src/modules/support/index.ts`
- Modify: `apps/backend/src/modules/notifications/types.ts` (one new `NotificationKind`)
- Modify: `apps/backend/src/env.ts` (four new optional vars with defaults)
- Test: `apps/backend/tests/modules/support/support-start.test.ts`

**Interfaces:**
- Consumes: `supportVerificationsRepo` (Task 2); `usersRepo.findByPhone(db, phone): Promise<UserRow | undefined>` from `modules/identity`; `deviceTokensRepo.listByUser(db, userId): Promise<DeviceTokenRow[]>` from `modules/notifications`; `expoPushProvider.send(db, intent: NotificationIntent, rendered: RenderedNotification)`; `termiiSmsProvider.send(db, intent, rendered)`; `auditRepo.append`.
- Produces:

```ts
export type StartResult = {
  verificationId: string;
  matchNumber: number;      // always present, even when nothing was dispatched
  decoys: [number, number]; // shown to the CUSTOMER, not the operator
};
export type CapBreach = { capped: true; retryAfterSeconds: number };

export const supportVerificationService: {
  start(db: DbOrTx, input: { actorAdminUserId: string; phoneE164: string }):
    Promise<StartResult | CapBreach>;
};
```

**Why `matchNumber` is generated even when nobody matched:** the operator screen renders it either way. A code path that skipped generation would make the response shape differ between a real customer and a stranger's number, which is the oracle the whole design refuses.

**Dispatch bypasses `notificationService.dispatch` deliberately.** That service resolves recipient preferences, quiet hours and snooze before fanning out — correct for a settlement alert, wrong here. A customer who has silenced push, or who calls at 23:00, must still receive their verification: they are on the phone asking for it, and a security challenge that a preference can suppress is a security challenge that fails closed against the user. This task therefore calls the providers directly, and the reason belongs in a comment beside the call so nobody "tidies" it back through the service.

`NotificationKind` is a **closed union**, and `NotificationIntent.kind` must be one of its members, so this task adds `'support_verification'` to it (Step 3a). That is the smallest change that keeps the provider's type contract honest.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/modules/support/support-start.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { supportVerificationService, supportVerificationsRepo } from '../../../src/modules/support';
import { signedInAdmin } from '../../helpers/admin-session';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('supportVerificationService.start', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('answers identically for a number that matches nobody', async () => {
    const { adminUserId } = await signedInAdmin('s1@amana-ng.com', ['support']);

    const result = await supportVerificationService.start(testDb, {
      actorAdminUserId: adminUserId,
      phoneE164: '+2348019999999',
    });

    if ('capped' in result) throw new Error('unexpected cap');
    expect(result.verificationId).toBeTruthy();
    expect(result.matchNumber).toBeGreaterThanOrEqual(10);
    expect(result.matchNumber).toBeLessThanOrEqual(99);
    expect(result.decoys).toHaveLength(2);

    const row = await supportVerificationsRepo.findById(testDb, result.verificationId);
    expect(row?.userId).toBeNull();
    expect(row?.rail).toBe('none');
  });

  it('never repeats a number among the match and its decoys', async () => {
    const { adminUserId } = await signedInAdmin('s2@amana-ng.com', ['support']);
    for (let i = 0; i < 30; i++) {
      const result = await supportVerificationService.start(testDb, {
        actorAdminUserId: adminUserId,
        phoneE164: `+23480188${String(10000 + i)}`,
      });
      if ('capped' in result) throw new Error('unexpected cap');
      const all = [result.matchNumber, ...result.decoys];
      expect(new Set(all).size).toBe(3);
    }
  });

  it('caps one phone across two different operators', async () => {
    const a = await signedInAdmin('s3@amana-ng.com', ['support']);
    const b = await signedInAdmin('s4@amana-ng.com', ['support']);
    const phone = '+2348017777777';

    for (let i = 0; i < 5; i++) {
      const r = await supportVerificationService.start(testDb, {
        actorAdminUserId: a.adminUserId,
        phoneE164: phone,
      });
      expect('capped' in r).toBe(false);
    }

    const sixth = await supportVerificationService.start(testDb, {
      actorAdminUserId: b.adminUserId,
      phoneE164: phone,
    });

    expect('capped' in sixth).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/support/support-start.test.ts`
Expected: FAIL — `supportVerificationService` is not exported.

- [ ] **Step 3: Add the env vars**

In `apps/backend/src/env.ts`, add to the Zod shape alongside the other tunables (all optional with defaults, so no environment breaks):

```ts
SUPPORT_PENDING_SECONDS: z.coerce.number().int().positive().default(180),
SUPPORT_SESSION_SECONDS: z.coerce.number().int().positive().default(900),
SUPPORT_STARTS_PER_OPERATOR_HOUR: z.coerce.number().int().positive().default(20),
SUPPORT_STARTS_PER_PHONE_DAY: z.coerce.number().int().positive().default(5),
```

Do **not** add these to the production `required` block — they have safe defaults, and the block is reserved for values whose absence boots a broken app.

- [ ] **Step 4: Write the service**

```ts
// apps/backend/src/modules/support/support-verification.service.ts
import { randomInt } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { auditRepo } from '../audit';
import { deviceTokensRepo } from '../notifications/device-tokens.repo';
import { expoPushProvider } from '../notifications/providers/expo-push.provider';
import { termiiSmsProvider } from '../notifications/providers/termii-sms.provider';
import type { NotificationIntent } from '../notifications/types';
import { usersRepo } from '../identity';
import { hashCode } from './code-hash';
import { supportVerificationsRepo } from './support-verifications.repo';

type DbOrTx = PostgresJsDatabase;

export type StartResult = {
  verificationId: string;
  matchNumber: number;
  decoys: [number, number];
};
export type CapBreach = { capped: true; retryAfterSeconds: number };

/** Three distinct two-digit numbers. Distinct because two equal options make the choice a lie. */
function threeNumbers(): { match: number; decoys: [number, number] } {
  const pool = new Set<number>();
  while (pool.size < 3) pool.add(randomInt(10, 100));
  const [match, a, b] = [...pool];
  return { match, decoys: [a, b] };
}

/**
 * Fisher-Yates with a CSPRNG. `Array.sort(() => Math.random() - 0.5)` is NOT a shuffle — it is
 * biased, and here a biased order means the match number sits in a predictable slot, which is
 * exactly what number matching exists to prevent.
 */
function shuffle(values: number[]): number[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const supportVerificationService = {
  async start(
    db: DbOrTx,
    input: { actorAdminUserId: string; phoneE164: string },
  ): Promise<StartResult | CapBreach> {
    const now = Date.now();
    const perOperator = await supportVerificationsRepo.countByOperatorSince(
      db,
      input.actorAdminUserId,
      new Date(now - 3_600_000),
    );
    if (perOperator >= env.SUPPORT_STARTS_PER_OPERATOR_HOUR) {
      return { capped: true, retryAfterSeconds: 3600 };
    }
    const perPhone = await supportVerificationsRepo.countByPhoneSince(
      db,
      input.phoneE164,
      new Date(now - 86_400_000),
    );
    if (perPhone >= env.SUPPORT_STARTS_PER_PHONE_DAY) {
      return { capped: true, retryAfterSeconds: 86_400 };
    }

    // Resolve, but never let the answer change the shape of what we return.
    const user = await usersRepo.findByPhone(db, input.phoneE164);
    const eligible = user && (user.role === 'principal' || user.role === 'agent') ? user : null;

    const { match, decoys } = threeNumbers();
    const tokens = eligible ? await deviceTokensRepo.listByUser(db, eligible.id) : [];
    const rail = !eligible ? 'none' : tokens.length > 0 ? 'push' : 'sms';
    const code = rail === 'sms' ? String(randomInt(100000, 1000000)) : null;

    const row = await supportVerificationsRepo.create(db, {
      adminUserId: input.actorAdminUserId,
      phoneE164: input.phoneE164,
      userId: eligible?.id ?? null,
      rail,
      matchNumber: rail === 'push' ? match : null,
      codeHash: code ? hashCode(code) : null,
      expiresAt: new Date(now + env.SUPPORT_PENDING_SECONDS * 1000),
    });

    // Direct to the provider, NOT through notificationService.dispatch: preferences, quiet hours
    // and snooze must not be able to suppress a verification the customer is on the phone asking
    // for. Do not "tidy" this back through the service.
    if (eligible && rail !== 'none') {
      const intent: NotificationIntent = {
        kind: 'support_verification',
        recipientUserId: eligible.id,
        dedupeKey: `support:${row.id}`,
        payload: { verificationId: row.id },
      };
      if (rail === 'push') {
        await expoPushProvider.send(db, intent, {
          title: 'Amana support',
          body: 'Tap the number your support agent reads to you.',
          data: {
            kind: 'support_verification',
            verificationId: row.id,
            options: shuffle([match, ...decoys]),
          },
        });
      } else if (code) {
        await termiiSmsProvider.send(db, intent, {
          title: 'Amana support',
          body: `Amana support code: ${code}. Only read this to an agent YOU called. It expires in 3 minutes.`,
          // `data` is required on RenderedNotification; SMS has nothing structured to carry.
          data: {},
        });
      }
    }

    await auditRepo.append(db, {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action: 'support.verification.started',
      subjectKind: 'support_verification',
      subjectId: row.id,
      // The phone is recorded; whether it matched a customer is NOT, so the audit log does not
      // become the oracle the API refuses to be.
      payloadJson: { phoneE164: input.phoneE164 },
    });

    return { verificationId: row.id, matchNumber: match, decoys };
  },
};
```

- [ ] **Step 3a: Add the notification kind**

`NotificationIntent.kind` is typed against a closed union, so the push will not typecheck without this. In `apps/backend/src/modules/notifications/types.ts`:

```ts
export type NotificationKind =
  | 'bump_requested'
  | 'bump_decided'
  | 'txn_settled'
  | 'txn_failed'
  | 'anomaly_alert'
  | 'refund_received'
  | 'support_verification';
```

Then run `pnpm --filter @amana/backend typecheck` and fix any exhaustive `switch` over `NotificationKind` that the new member breaks — templates and preference resolution are the likely sites. A compiler error here is the type system doing its job; do not cast it away.

- [ ] **Step 5: Write the code hasher**

```ts
// apps/backend/src/modules/support/code-hash.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';

/**
 * Domain-separated subkey derived from FIELD_ENCRYPTION_KEY, following the same pattern as
 * `modules/marketplace/codes.ts`. Deriving rather than using the field key directly means this
 * use can never collide with at-rest field encryption, and a leak of one does not become a leak
 * of the other.
 */
function supportCodeSecret(): Buffer {
  const fieldKey = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'hex');
  return createHmac('sha256', fieldKey).update('amana:support:verification-code:v1').digest();
}

/** HMAC rather than a bare digest: a 6-digit space is trivially rainbow-tabled otherwise. */
export function hashCode(code: string): string {
  return createHmac('sha256', supportCodeSecret()).update(code).digest('hex');
}

export function codeMatches(code: string, hash: string): boolean {
  const a = Buffer.from(hashCode(code), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 6: Export and run the tests**

Add to `apps/backend/src/modules/support/index.ts`:

```ts
export {
  supportVerificationService,
  type CapBreach,
  type StartResult,
} from './support-verification.service';
```

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/support/support-start.test.ts`
Expected: PASS, three cases.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome check --write .
git add apps/backend/src apps/backend/tests
git commit -m "feat(support): start a verification, and answer the same for a stranger's number"
```

---

### Task 4: Responding — number matching and code read-back

**Files:**
- Modify: `apps/backend/src/modules/support/support-verification.service.ts`
- Modify: `apps/backend/src/modules/support/index.ts`
- Test: `apps/backend/tests/modules/support/support-respond.test.ts`

**Interfaces:**
- Consumes: Task 3's service and repo.
- Produces:

```ts
export type RespondOutcome = 'verified' | 'denied' | 'expired' | 'not_found';

// Customer taps a number in the app.
respondFromCustomer(db: DbOrTx, input: {
  verificationId: string; userId: string; chosenNumber: number;
}): Promise<RespondOutcome>;

// Operator types the code the customer read out.
confirmCode(db: DbOrTx, input: {
  verificationId: string; actorAdminUserId: string; code: string;
}): Promise<RespondOutcome>;

// The gate every read endpoint calls. Throws `SupportSessionError` when not live.
requireLiveSession(db: DbOrTx, input: {
  verificationId: string; actorAdminUserId: string;
}): Promise<SupportVerificationRow>;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/modules/support/support-respond.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { supportVerificationService, supportVerificationsRepo } from '../../../src/modules/support';
import { signedInAdmin } from '../../helpers/admin-session';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

/**
 * `support_verifications.user_id` has a foreign key to `users.id`, so a random UUID here is a
 * constraint violation, not a convenient stand-in. Seed a real customer.
 */
const seedPrincipal = async () =>
  usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });

const startPush = async (adminUserId: string, userId: string) =>
  supportVerificationsRepo.create(testDb, {
    adminUserId,
    phoneE164: '+2348011111111',
    userId,
    rail: 'push',
    matchNumber: 42,
    codeHash: null,
    expiresAt: new Date(Date.now() + 180_000),
  });

describe('responding to a verification', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('verifies when the customer taps the number the operator read', async () => {
    const { adminUserId } = await signedInAdmin('r1@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await startPush(adminUserId, userId);

    const outcome = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 42,
    });

    expect(outcome).toBe('verified');
  });

  it('denies immediately on a wrong tap — a one-in-three guess is not retryable', async () => {
    const { adminUserId } = await signedInAdmin('r2@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await startPush(adminUserId, userId);

    const first = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 17,
    });
    const second = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 42,
    });

    expect(first).toBe('denied');
    expect(second).toBe('denied');
  });

  it('refuses a response from a different customer than the one it was sent to', async () => {
    const { adminUserId } = await signedInAdmin('r3@amana-ng.com', ['support']);
    const addressee = await seedPrincipal();
    const someoneElse = await seedPrincipal();
    const row = await startPush(adminUserId, addressee.id);

    const outcome = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId: someoneElse.id,
      chosenNumber: 42,
    });

    expect(outcome).toBe('not_found');
  });

  it('expires rather than verifying once the pending window has passed', async () => {
    const { adminUserId } = await signedInAdmin('r4@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: '+2348012222222',
      userId,
      rail: 'push',
      matchNumber: 42,
      codeHash: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    const outcome = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 42,
    });

    expect(outcome).toBe('expired');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/support/support-respond.test.ts`
Expected: FAIL — `respondFromCustomer` is not a function.

- [ ] **Step 3: Implement the three methods**

Append to `support-verification.service.ts` inside the exported object:

```ts
  async respondFromCustomer(
    db: DbOrTx,
    input: { verificationId: string; userId: string; chosenNumber: number },
  ): Promise<RespondOutcome> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    // A verification addressed to someone else is "not found", never "wrong customer" — the
    // caller must not learn that the id exists.
    if (!row || row.userId !== input.userId) return 'not_found';
    if (row.status !== 'pending') return row.status === 'verified' ? 'verified' : 'denied';
    if (row.expiresAt.getTime() <= Date.now()) return 'expired';

    if (row.matchNumber !== input.chosenNumber) {
      await supportVerificationsRepo.markDenied(db, row.id);
      await auditRepo.append(db, {
        actorKind: 'user',
        actorUserId: input.userId,
        action: 'support.verification.denied',
        subjectKind: 'support_verification',
        subjectId: row.id,
        payloadJson: { reason: 'wrong_number' },
      });
      return 'denied';
    }

    const verified = await supportVerificationsRepo.markVerified(
      db,
      row.id,
      new Date(Date.now() + env.SUPPORT_SESSION_SECONDS * 1000),
    );
    if (!verified) return 'denied';
    await auditRepo.append(db, {
      actorKind: 'user',
      actorUserId: input.userId,
      action: 'support.verification.verified',
      subjectKind: 'support_verification',
      subjectId: row.id,
      payloadJson: { rail: row.rail },
    });
    return 'verified';
  },

  async confirmCode(
    db: DbOrTx,
    input: { verificationId: string; actorAdminUserId: string; code: string },
  ): Promise<RespondOutcome> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    if (!row || row.adminUserId !== input.actorAdminUserId) return 'not_found';
    if (row.status !== 'pending') return row.status === 'verified' ? 'verified' : 'denied';
    if (row.expiresAt.getTime() <= Date.now()) return 'expired';
    if (!row.codeHash) return 'denied';

    if (!codeMatches(input.code, row.codeHash)) {
      const attempts = await supportVerificationsRepo.incrementAttempts(db, row.id);
      if (attempts >= 3) await supportVerificationsRepo.markDenied(db, row.id);
      return 'denied';
    }

    const verified = await supportVerificationsRepo.markVerified(
      db,
      row.id,
      new Date(Date.now() + env.SUPPORT_SESSION_SECONDS * 1000),
    );
    return verified ? 'verified' : 'denied';
  },

  async requireLiveSession(
    db: DbOrTx,
    input: { verificationId: string; actorAdminUserId: string },
  ): Promise<SupportVerificationRow> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    // Bound to the operator who started it: a verified session is not a token another member of
    // staff can pick up.
    if (!row || row.adminUserId !== input.actorAdminUserId) throw new SupportSessionError();
    if (row.status !== 'verified' || !row.userId) throw new SupportSessionError();
    if (!row.sessionExpiresAt || row.sessionExpiresAt.getTime() <= Date.now()) {
      throw new SupportSessionError();
    }
    return row;
  },
```

And above the object:

```ts
export type RespondOutcome = 'verified' | 'denied' | 'expired' | 'not_found';

export class SupportSessionError extends Error {
  constructor() {
    super('no live verified support session');
    this.name = 'SupportSessionError';
  }
}
```

Import `codeMatches` from `./code-hash` and `SupportVerificationRow` from the repo.

- [ ] **Step 3a: Export the new surface from the barrel**

Tasks 6 and 7 import `SupportSessionError` and the new methods from `../../src/modules/support`, so the barrel must carry them. In `apps/backend/src/modules/support/index.ts`, extend the service export:

```ts
export {
  supportVerificationService,
  SupportSessionError,
  type CapBreach,
  type RespondOutcome,
  type StartResult,
} from './support-verification.service';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/support/support-respond.test.ts`
Expected: PASS, four cases.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write .
git add apps/backend/src apps/backend/tests
git commit -m "feat(support): number matching, one attempt, bound to the operator who asked"
```

---

### Task 5: The operator routes, and the requirements they create

**Files:**
- Create: `apps/backend/src/routes/admin/support.ts`
- Modify: `apps/backend/src/modules/support/support-verification.service.ts` (adds `readStatus`)
- Modify: `apps/backend/src/server.ts` (mount at `/admin/support`)
- Modify: `docs/business/RRD.md` (§1.15, IAM-21 onward)
- Test: `apps/backend/tests/routes/admin/support.test.ts`

**Interfaces:**
- Consumes: `supportVerificationService`, `adminSession()`, `adminIamService.requirePermission`.
- Produces three endpoints:

| Method + path | Permission | Returns |
|---|---|---|
| `POST /admin/support/verifications` | `support.verify` | `202 { verificationId, matchNumber }` or `429 { error: 'rate_limited' }` |
| `POST /admin/support/verifications/:id/code` | `support.verify` | `200 { outcome }` |
| `GET /admin/support/verifications/:id` | `support.verify` | `200 { status, expiresAt, sessionExpiresAt }` |

**`decoys` are never returned to the operator.** They go to the customer's device only. An operator holding all three numbers could read the wrong one deliberately and watch which the customer taps.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/routes/admin/support.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../src/server';
import { signedInAdmin } from '../../helpers/admin-session';
import { truncateAll } from '../../helpers/test-db';

const app = createServer();

describe('POST /admin/support/verifications', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('accepts a start from support and never returns the decoys', async () => {
    const { cookie } = await signedInAdmin('v1@amana-ng.com', ['support']);

    const res = await app.request('/admin/support/verifications', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348013333333' }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.verificationId).toBeTruthy();
    expect(body.matchNumber).toBeGreaterThanOrEqual(10);
    expect(body).not.toHaveProperty('decoys');
  });

  it('refuses an operator without support.verify', async () => {
    const { cookie } = await signedInAdmin('v2@amana-ng.com', ['ops']);

    const res = await app.request('/admin/support/verifications', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348014444444' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 429 rather than a silent 202 once the phone cap is reached', async () => {
    const { cookie } = await signedInAdmin('v3@amana-ng.com', ['support']);
    const phone = '+2348015555555';
    const post = () =>
      app.request('/admin/support/verifications', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(202);

    expect((await post()).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin/support.test.ts`
Expected: FAIL — 404, the route is not mounted.

- [ ] **Step 3: Write the route**

```ts
// apps/backend/src/routes/admin/support.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { parseBody, parseParams } from '../../lib/validate';
import { type AdminActorVariables, adminSession } from '../../middleware/admin-session';
import { adminIamService } from '../../modules/admin/admin-iam.service';
import { supportVerificationService } from '../../modules/support';

const StartBody = z.object({ phone: z.string().regex(/^\+\d{8,15}$/) });
const CodeBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const IdParams = z.object({ id: z.string().uuid() });

export const adminSupportRoute = new Hono<{ Variables: AdminActorVariables }>()
  .use('*', adminSession())

  .post('/verifications', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'support.verify');
    const body = await parseBody(c, StartBody);
    if (body instanceof Response) return body;

    const result = await supportVerificationService.start(db, {
      actorAdminUserId: actor.adminUserId,
      phoneE164: body.phone,
    });
    if ('capped' in result) {
      c.header('Retry-After', String(result.retryAfterSeconds));
      return c.json({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds }, 429);
    }
    // `decoys` deliberately not returned: the operator reads ONE number, and an operator holding
    // all three could read a wrong one and learn from which the customer taps.
    return c.json({ verificationId: result.verificationId, matchNumber: result.matchNumber }, 202);
  })

  .post('/verifications/:id/code', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'support.verify');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, CodeBody);
    if (body instanceof Response) return body;

    const outcome = await supportVerificationService.confirmCode(db, {
      verificationId: params.id,
      actorAdminUserId: actor.adminUserId,
      code: body.code,
    });
    return c.json({ outcome });
  })

  .get('/verifications/:id', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'support.verify');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;

    const status = await supportVerificationService.readStatus(db, {
      verificationId: params.id,
      actorAdminUserId: actor.adminUserId,
    });
    if (!status) return c.json({ error: 'not_found' }, 404);
    return c.json(status);
  });
```

Add `readStatus` to the service — it returns `{ status, expiresAt, sessionExpiresAt }` for a row belonging to this operator, and `null` otherwise:

```ts
  async readStatus(
    db: DbOrTx,
    input: { verificationId: string; actorAdminUserId: string },
  ): Promise<{ status: string; expiresAt: string; sessionExpiresAt: string | null } | null> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    if (!row || row.adminUserId !== input.actorAdminUserId) return null;
    const expired = row.status === 'pending' && row.expiresAt.getTime() <= Date.now();
    return {
      status: expired ? 'expired' : row.status,
      expiresAt: row.expiresAt.toISOString(),
      sessionExpiresAt: row.sessionExpiresAt?.toISOString() ?? null,
    };
  },
```

- [ ] **Step 4: Mount it**

In `apps/backend/src/server.ts`, beside the other `/admin` mounts:

```ts
app.route('/admin/support', adminSupportRoute);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin/support.test.ts`
Expected: PASS, three cases.

- [ ] **Step 6: Write the requirements this creates**

In `docs/business/RRD.md` §1.15, continue the IAM series (Task 5 stopped at IAM-20). Add at least:

- **IAM-21** — Support verification always answers `202`, whether or not the phone resolves to a customer.
- **IAM-22** — Push verification is number matching, one attempt; SMS verification is a six-digit read-back, three attempts.
- **IAM-23** — A verified session is bound to the operator who started it and expires after `SUPPORT_SESSION_SECONDS`.
- **IAM-24** — Starts are capped per operator per hour and per phone per day, counted in the database; a breach returns `429`.
- **IAM-25** — `support` may verify principals and agents only.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome check --write .
py -3 tools/docs/validate-tables.py
git add apps/backend/src apps/backend/tests docs/business/RRD.md
git commit -m "feat(support): operator routes, and the five requirements they create"
```

---

### Task 6: The customer's response endpoint

**Files:**
- Create: `apps/backend/src/routes/support-respond.ts`
- Modify: `apps/backend/src/server.ts`
- Test: `apps/backend/tests/routes/support-respond.test.ts`

**Interfaces:**
- Consumes: `supportVerificationService.respondFromCustomer`, `jwtAuth()` middleware (which sets the authenticated user id exactly as the other customer routes read it — follow `routes/me-bumps.ts` for the accessor).
- Produces: `POST /support/verifications/:id/respond` with body `{ chosenNumber: number }`, returning `200 { outcome }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/routes/support-respond.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../src/server';
import { supportVerificationsRepo } from '../../src/modules/support';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { bearerHeaders } from '../helpers/bearer';
import { signedInAdmin } from '../helpers/admin-session';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

// `bearerHeaders` takes a UserRow; it does not create one. The FK on user_id is real.
const seedPrincipal = async () =>
  usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });

const app = createServer();

describe('POST /support/verifications/:id/respond', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('verifies when the signed-in customer taps the right number', async () => {
    const { adminUserId } = await signedInAdmin('c1@amana-ng.com', ['support']);
    const customer = await seedPrincipal();
    const row = await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: '+2348016666666',
      userId: customer.id,
      rail: 'push',
      matchNumber: 42,
      codeHash: null,
      expiresAt: new Date(Date.now() + 180_000),
    });

    const res = await app.request(`/support/verifications/${row.id}/respond`, {
      method: 'POST',
      headers: await bearerHeaders(customer),
      body: JSON.stringify({ chosenNumber: 42 }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('verified');
  });

  it('rejects an unauthenticated response', async () => {
    const res = await app.request(`/support/verifications/${crypto.randomUUID()}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chosenNumber: 42 }),
    });

    expect(res.status).toBe(401);
  });
});
```

`bearerHeaders(user: UserRow)` returns `{ Authorization, 'content-type' }` — it signs an existing user in and does **not** create one, which is why the fixture seeds a principal first. Follow `tests/routes/me-bumps.test.ts` for the seeding shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/support-respond.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write the route, mount it, run the test**

Follow `routes/me-bumps.ts` exactly for the `jwtAuth()` wiring and the user-id accessor. The handler validates `{ chosenNumber: z.number().int().min(10).max(99) }`, calls `respondFromCustomer`, and returns `{ outcome }`. It returns `200` for every outcome including `not_found`, because a customer must not be able to probe which verification ids exist.

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/support-respond.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write .
git add apps/backend/src apps/backend/tests
git commit -m "feat(support): the customer's half of number matching"
```

---

### Task 7: The reads, and what they leave out

**Files:**
- Create: `apps/backend/src/modules/support/support-read.service.ts`
- Modify: `apps/backend/src/routes/admin/support.ts`
- Test: `apps/backend/tests/routes/admin/support-reads.test.ts`

**Interfaces:**
- Consumes: `requireLiveSession` (Task 4); existing wallet, transaction and rule repos.
- Produces three endpoints, each requiring `support.read` **and** a live session:

| Path | Shape |
|---|---|
| `GET /admin/support/verifications/:id/overview` | `{ maskedAccount, balances, subWallets: [{ name, limits }] }` |
| `GET /admin/support/verifications/:id/transactions` | `{ transactions: [{ id, amountKobo, occurredAt, status, denialReason, deniedByRuleName }] }` |
| `GET /admin/support/verifications/:id/rules` | `{ rules: [{ name, kind, active }] }` |

- [ ] **Step 1: Write the failing test — the omissions are the assertion**

```ts
// apps/backend/tests/routes/admin/support-reads.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../src/server';
import { supportVerificationsRepo } from '../../../src/modules/support';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { signedInAdmin } from '../../helpers/admin-session';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const seedPrincipal = async () =>
  usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });

const app = createServer();

const verifiedSession = async (adminUserId: string, userId: string) => {
  const row = await supportVerificationsRepo.create(testDb, {
    adminUserId,
    phoneE164: '+2348018888888',
    userId,
    rail: 'push',
    matchNumber: 42,
    codeHash: null,
    expiresAt: new Date(Date.now() + 180_000),
  });
  await supportVerificationsRepo.markVerified(testDb, row.id, new Date(Date.now() + 900_000));
  return row;
};

describe('support reads', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('never returns bvn, nin, name, address or a full account number', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd1@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await verifiedSession(adminUserId, userId);

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie },
    });
    const raw = await res.text();

    expect(res.status).toBe(200);
    for (const forbidden of ['bvn', 'nin', 'fullName', 'address', 'dateOfBirth']) {
      expect(raw).not.toContain(forbidden);
    }
    expect(JSON.parse(raw).maskedAccount).toMatch(/^••••\d{4}$/);
  });

  it('refuses the read once the session has expired', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd2@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: '+2348018888881',
      userId,
      rail: 'push',
      matchNumber: 42,
      codeHash: null,
      expiresAt: new Date(Date.now() + 180_000),
    });
    await supportVerificationsRepo.markVerified(testDb, row.id, new Date(Date.now() - 1000));

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie },
    });

    expect(res.status).toBe(403);
  });

  it('refuses a different operator holding the same verification id', async () => {
    const owner = await signedInAdmin('rd3@amana-ng.com', ['support']);
    const other = await signedInAdmin('rd4@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await verifiedSession(owner.adminUserId, userId);

    const res = await app.request(`/admin/support/verifications/${row.id}/overview`, {
      headers: { cookie: other.cookie },
    });

    expect(res.status).toBe(403);
  });

  it('writes an audit row naming the operator and the verification', async () => {
    const { cookie, adminUserId } = await signedInAdmin('rd5@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await verifiedSession(adminUserId, userId);

    await app.request(`/admin/support/verifications/${row.id}/transactions`, {
      headers: { cookie },
    });

    const { auditRepo } = await import('../../../src/modules/audit');
    const entries = await auditRepo.listBySubject(testDb, row.id);
    const read = entries.find((e) => e.action === 'support.read.transactions');
    expect(read?.actorAdminUserId).toBe(adminUserId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin/support-reads.test.ts`
Expected: FAIL — 404 on every read path.

- [ ] **Step 3: Write the read service**

Build the response objects **field by field**, never by spreading a row. Spreading is how BVN reaches a response: `{...user}` picks up every column the table gains later, including ones added after this code was reviewed. The service returns only the fields listed in the table above.

`maskedAccount` is `'••••' + accountNumber.slice(-4)`. Masking happens in this service, never in a route or a component, so there is one place to audit.

- [ ] **Step 4: Add the three endpoints**

Each one: `requirePermission(support.read)` → `requireLiveSession` (catching `SupportSessionError` as `403`) → read → `auditRepo.append` with `actorKind: 'ops'`, `actorAdminUserId`, `action: 'support.read.<what>'`, `subjectKind: 'support_verification'`, `subjectId: verificationId`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin/support-reads.test.ts`
Expected: PASS, four cases.

- [ ] **Step 6: Run the whole backend suite**

Run: `pnpm --filter @amana/backend test`
Expected: all green, output pristine.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome check --write .
git add apps/backend/src apps/backend/tests
git commit -m "feat(support): three reads that are defined by what they omit"
```

---

### Task 8: The operator screen

**Files:**
- Create: `apps/admin-portal/src/app/support/page.tsx`
- Modify: the portal's navigation rail (follow how `/people` and `/ops/retailers` are registered)
- Modify: `docs/business/UI-UX-DESIGN-BRIEF.md` (§10)
- Modify: `docs/runbook/admin-portal.md`
- Test: extend `tools/demo/probe-admin-portal.mjs` with the support screen

**Interfaces:**
- Consumes: the Task 5 and Task 7 endpoints through the portal's existing same-origin proxy — never a direct backend URL.

- [ ] **Step 1: Build the screen**

One phone input and a Start button. On `202`, render the verification card: the match number **large**, a six-digit code field beside it, the live status, and a countdown to `expiresAt`. The copy must not say which rail was used:

> *If they got a notification, read them **{matchNumber}** and ask them to tap it. If they got a text, ask them to read you the code.*

On `429`, say plainly that the limit was reached and which one, because the operator needs to know it was staff and not the customer.

After `verified`, render the three read panels. Follow the Task 5 convention: every panel states what it is **not** showing — *"Support never sees name, BVN or NIN."*

- [ ] **Step 2: Extend the browser probe**

Mint a `support`-role session, start a verification against a number that matches nobody, and assert the screen shows the waiting state and never a "no such customer" message.

Run: `node tools/demo/probe-admin-portal.mjs`
Expected: the new step passes with the others.

- [ ] **Step 3: Update the design brief and runbook**

§10 of the brief gains the support screen: the match number as the one piece of display-scale type, and the standing rule that every panel names its omissions. The runbook gains what the `support` role renders and the known limit that the audit rows this generates are not readable in the portal.

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write .
py -3 tools/docs/validate-tables.py
git add apps/admin-portal tools/demo docs/business/UI-UX-DESIGN-BRIEF.md docs/runbook/admin-portal.md
git commit -m "feat(admin-portal): the support screen, which says what it will not show you"
```

---

### Task 9: The principal app's approve surface

**Files:**
- Create: `apps/principal/src/screens/SupportApproveScreen.tsx`
- Modify: `apps/principal/src/nav/MainStack.tsx`
- Modify: `packages/api-client/src/support.ts` (new) and its barrel
- Test: `packages/api-client/src/support.test.ts`

**Interfaces:**
- Produces: `SupportApi.respond(verificationId: string, chosenNumber: number): Promise<{ outcome: string }>` on the shared client, so the agent app in Task 10 consumes the same one.

- [ ] **Step 1: Write the failing client test**

Follow the existing `packages/api-client` test style: assert the request path, method and body, and that a non-2xx becomes an `ApiError`. Run it, watch it fail, then implement.

- [ ] **Step 2: Build the screen**

Three large number buttons in a random order. One tap only — disable all three immediately on press, because the server allows one attempt and a double-tap must not look like the customer's fault. The warning line is load-bearing and must not be softened:

> *Only approve if you called Amana support and they read you this number.*

Raised by the push (`data.kind === 'support_verification'`), with an inbox entry as the fallback for a push tapped late.

- [ ] **Step 3: Build the client package before typechecking the app**

```bash
pnpm --filter @amana/api-client build
pnpm --filter @amana/principal typecheck
```

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write .
git add packages/api-client apps/principal
git commit -m "feat(principal): tap the number support reads you, once"
```

---

### Task 10: The agent app, and the flow written down

**Files:**
- Create: `apps/agent/src/screens/SupportApproveScreen.tsx`
- Modify: `apps/agent/src/nav/MainStack.tsx`
- Modify: `docs/business/APP-FLOW.md` (§9)

**Interfaces:**
- Consumes: `SupportApi.respond` from Task 9. Do not write a second client.

- [ ] **Step 1: Build the agent screen**

Same component shape and the same warning copy as Task 9. Agents are the likelier callers — a declined spend at a till is the commonest support case — so this is not the lesser half.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

- [ ] **Step 3: Write the flow**

`APP-FLOW.md` §9 gains the support arc, in the file's existing ASCII-tree notation: call → operator starts → the rail fork → number matching or code read-back → the verified session and what it shows → expiry. Draw the "no such customer" path explicitly as **identical** to the unanswered path, because that equivalence is the security property and a flow diagram that omits it invites someone to "fix" it.

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write .
py -3 tools/docs/validate-tables.py
git add apps/agent docs/business/APP-FLOW.md
git commit -m "feat(agent): the support approval, and the arc drawn end to end"
```

---

### Task 11: Close out the sub-plan and the index

**Files:**
- Modify: `docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md`
- Modify: `docs/product/README.md`

- [ ] **Step 1: Mark Task 6 built**

Mirror the Tasks 1–5 convention: `### Task 6 — … ✅ built 2026-09-16`, plus a "Decided during Task 6" block recording number matching, the DB-counted caps, and the explicit `429`.

- [ ] **Step 2: Make the index true**

Re-open `docs/product/README.md` and check every row against what now exists. At minimum the TRD row gains IAM-21–25, the user-flow row gains §9's support arc, the design-system row gains §10's support screen, and the schema row's count moves. This is the step the index itself records four separate PRs for skipping.

- [ ] **Step 3: Run every guard**

```bash
py -3 tools/docs/validate_schema_doc.py
py -3 tools/docs/validate-tables.py
py -3 -m unittest discover -s tools/docs
pnpm --filter @amana/backend test
```

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: A1 Task 6 is built, and the index says what is now true"
```

---

## Verification checklist

- [ ] A number matching nobody and a number whose owner ignored the push are indistinguishable in status, timing and response shape.
- [ ] A wrong tap denies permanently; a second tap with the right number still denies.
- [ ] A verified session cannot be used by a second operator, and dies at `sessionExpiresAt`.
- [ ] No support response contains `bvn`, `nin`, a full name, an address, a date of birth, or a full account number — asserted against the raw response text, not a parsed object.
- [ ] Every read writes an audit row naming the operator and the verification.
- [ ] Caps survive a process restart, because they are counted in the database.
- [ ] `validate_schema_doc.py` reports 41 tables, 42 enums, 50 migrations and agrees with the doc.
- [ ] `pnpm --filter @amana/backend test` is green with pristine output.
