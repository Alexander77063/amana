# Sub-plan 4 — Vendor capture + Lifecycle handoff to NIP-out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the spend pathway end-to-end. Vendor capture (NIBSS name enquiry, NQR decode, phone lookup, sticker resolver, smart recents) + transaction intent creation + lifecycle handoff from `IN_FLIGHT` to actual NIP-out via the Anchor adapter + webhook handlers that finalise (settle / reverse / topup) + reconciliation runner + the public HTTP routes that the agent and principal apps will call.

**Architecture:**
- **Vendor resolution is unified.** A single `vendor-resolution.service.resolve(input)` accepts any of the four input shapes (typed account, phone number, NQR string, sticker UUID) and returns a `ResolvedVendor` (or a typed error). Each capture path is its own pure-or-thin service that the unifier composes — keeps tests focused.
- **Recents is a per-sub-wallet rolling window.** Top 10, ordered by `lastUsedAt`. Insert promotes if already present; otherwise inserts and trims oldest.
- **NIP-out is two-phase.** Phase 1 (synchronous): write reservation postings (debit sub-wallet, credit suspense), then call Anchor's transfer endpoint with idempotency key. Phase 2 (asynchronous): webhook handler reads the result and calls settlement (debit suspense, credit external + book fee) or reversal (mirror the reservation back). The transaction stays in `IN_FLIGHT` between the two phases.
- **Webhooks dispatch by event type** through a typed router. The Sub-plan 2 `/webhooks/anchor` route currently only audit-logs; this sub-plan extends it to actually call settlement / reversal / topup handlers based on `event.type`. Idempotency on `event.id` already lands in Sub-plan 2.
- **Reconciliation is a periodic batch.** For any txn in `IN_FLIGHT > 5 min`, query Anchor's transfer-status endpoint by idempotency key and finalise locally (settle/fail). Standalone script for ad-hoc + a documented cron entrypoint for production (cron itself is Sub-plan 5/8).
- **Auth is a placeholder.** Routes accept `x-actor-user-id` and `x-actor-role` headers as a minimal trust boundary. Real JWT/session auth lands in Sub-plan 6 (when the principal app builds the login flow).

**Tech Stack:** All inherited. No new runtime deps.

**Out of scope for this sub-plan (covered in later sub-plans):**
- Real authentication (JWT, sessions, login flow) — Sub-plan 6
- Notifications (push to principal on bump, push to agent on settle) — Sub-plan 5
- Cron scheduler that periodically invokes the recon runner — Sub-plan 5/8
- Mobile UI — Sub-plans 6 + 7
- Live integration testing against Anchor sandbox — Sub-plan 8

**Plan length:** ~35 tasks across 13 phases.

---

## File structure produced by this plan

```
apps/backend/src/
├── db/schema/
│   └── recents.ts                                NEW (vendor_recents)
├── modules/
│   ├── vendors/
│   │   ├── types.ts                              NEW (ResolvedVendor, ResolveError)
│   │   ├── nqr-decoder.ts                        NEW (parse NIBSS QR string)
│   │   ├── name-enquiry.service.ts               NEW (Anchor wrapper)
│   │   ├── phone-lookup.service.ts               NEW (Decision #16)
│   │   ├── sticker-lookup.service.ts             NEW (wraps Sub-plan 2 stub)
│   │   ├── recents.repo.ts                       NEW
│   │   ├── recents.service.ts                    NEW (insertOrPromote + listTop)
│   │   ├── vendor-resolution.service.ts          NEW (unified entry)
│   │   └── index.ts                              NEW
│   └── transactions/
│       ├── lifecycle.service.ts                  EXISTS (Sub-plan 3)
│       ├── txn-intent.service.ts                 NEW (creates DRAFT txn)
│       ├── nip-out.service.ts                    NEW (reservation + Anchor call)
│       ├── settlement.service.ts                 NEW (finalise on transfer.completed)
│       ├── reversal.service.ts                   NEW (reverse on transfer.failed)
│       ├── topup.service.ts                      NEW (handle virtual_account.credited)
│       ├── reconciliation.service.ts             NEW (recon batch)
│       └── index.ts                              MODIFIED (re-export new services)
├── middleware/
│   └── actor.ts                                  NEW (placeholder auth: parses x-actor-* headers)
└── routes/
    ├── webhooks.ts                               MODIFIED (dispatch to handlers)
    ├── vendors.ts                                NEW
    ├── transactions.ts                           NEW
    └── bumps.ts                                  NEW

apps/backend/scripts/
└── recon-runner.ts                               NEW (one-shot recon invocation)

apps/backend/tests/
├── modules/
│   ├── vendors/                                  NEW (one .test.ts per service)
│   └── transactions/                             EXTEND (intent / nip-out / settlement / reversal / topup / recon)
├── middleware/
│   └── actor.test.ts                             NEW
└── routes/
    ├── webhooks.test.ts                          EXTEND (dispatch tests)
    ├── vendors.test.ts                           NEW
    ├── transactions.test.ts                      NEW
    └── bumps.test.ts                             NEW
```

---

## Phase A — Schema for recents (Task 1)

### Task 1: vendor_recents schema + migration

**Files:**
- Create: `apps/backend/src/db/schema/recents.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Modify: `apps/backend/tests/helpers/test-db.ts` (add `vendor_recents` to TABLES_TO_TRUNCATE)
- Generated: `apps/backend/src/db/migrations/0014_recents.sql`

> **drizzle-kit 0.25 reminders** (carried from Sub-plan 2/3): BigInt defaults need `.default(sql\`0\`)`; `check()` not emitted; hand-rolled migrations need a journal entry.

- [ ] **Step 1: Write `apps/backend/src/db/schema/recents.ts`**

```ts
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { subWallets } from './wallet';

export const vendorRecents = pgTable(
  'vendor_recents',
  {
    subWalletId: uuid('sub_wallet_id')
      .notNull()
      .references(() => subWallets.id, { onDelete: 'cascade' }),
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    accountName: text('account_name').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subWalletId, t.bankCode, t.accountNumber] }),
  }),
);
```

Vendor identity is `(bankCode, accountNumber)`. The composite primary key (sub_wallet_id + bank_code + account_number) gives us upsert semantics for free — promote on conflict.

- [ ] **Step 2: Append `export * from './recents';` to `apps/backend/src/db/schema/index.ts`**

- [ ] **Step 3: Update `apps/backend/tests/helpers/test-db.ts` `TABLES_TO_TRUNCATE`** — add `'vendor_recents'` BEFORE `'sub_wallets'` (FK dependency).

- [ ] **Step 4: Generate + apply**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend exec drizzle-kit generate --name recents
pnpm --filter @amana/backend db:migrate
docker compose exec postgres psql -U amana -d amana_dev -c "\d+ vendor_recents"
```

- [ ] **Step 5: Schema smoke test `apps/backend/tests/modules/vendors/recents.repo.test.ts`** (just schema for now)

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('vendor_recents (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_recents' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'sub_wallet_id', 'bank_code', 'account_number',
      'account_name', 'last_used_at', 'first_seen_at',
    ]);
  });
});
```

- [ ] **Step 6: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/vendors/recents.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/db apps/backend/tests/helpers/test-db.ts apps/backend/tests/modules/vendors
git -C "C:/Users/alex_/amana" commit -m "feat(db): vendor_recents schema (composite PK on sub_wallet+bank+account)"
```

---

## Phase B — NQR decoder + vendor types (Tasks 2-3)

### Task 2: Vendor types

**Files:**
- Create: `apps/backend/src/modules/vendors/types.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/vendors/types.ts`**

```ts
import type { Kobo } from '../../lib/kobo';

export type ResolvedVendor = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  /** Where the resolution came from — useful for audit + UX. */
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents';
  /** Optional amount baked in (NQR can include amount; other paths set null). */
  suggestedAmountKobo: Kobo | null;
};

export type ResolveError =
  | { code: 'NOT_FOUND' }
  | { code: 'BAD_INPUT'; message: string }
  | { code: 'PARTNER_DOWN' }
  | { code: 'STICKER_UNBOUND' }
  | { code: 'STICKER_REVOKED' };
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/types.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): types (ResolvedVendor + ResolveError)"
```

---

### Task 3: NQR decoder (TDD)

NIBSS QR uses an EMV-Co-compatible TLV format. For MVP we decode the subset we need: bank code (sub-tag of merchant info template `26`), account number (sub-tag), optional transaction amount (root tag `54`), optional account name (root tag `59`). The format is `<2-digit-tag><2-digit-length><value>` repeated.

**Files:**
- Create: `apps/backend/src/modules/vendors/nqr-decoder.ts`
- Create: `apps/backend/tests/modules/vendors/nqr-decoder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { decodeNqr, encodeTlvForTest } from '../../../src/modules/vendors/nqr-decoder';
import { isErr, isOk } from '../../../src/lib/result';

describe('decodeNqr', () => {
  it('decodes a minimal QR with bank code + account number under merchant info', () => {
    // Merchant info template (tag 26) contains nested TLVs for GUID (00), bankCode (01), account (02)
    const merchantInfoValue =
      encodeTlvForTest('00', 'NG.NIBSS') +
      encodeTlvForTest('01', '058') +
      encodeTlvForTest('02', '0123456789');
    const qr = encodeTlvForTest('26', merchantInfoValue);
    const result = decodeNqr(qr);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.bankCode).toBe('058');
      expect(result.value.accountNumber).toBe('0123456789');
      expect(result.value.amountKobo).toBeNull();
      expect(result.value.accountName).toBeNull();
    }
  });

  it('decodes amount (tag 54) and account name (tag 59) when present', () => {
    const merchantInfoValue =
      encodeTlvForTest('00', 'NG.NIBSS') +
      encodeTlvForTest('01', '058') +
      encodeTlvForTest('02', '0123456789');
    const qr =
      encodeTlvForTest('26', merchantInfoValue) +
      encodeTlvForTest('54', '5200.50') +
      encodeTlvForTest('59', 'MUSA ABDULLAHI');
    const result = decodeNqr(qr);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.amountKobo).toBe(520050n);
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
    }
  });

  it('returns BAD_INPUT for non-TLV garbage', () => {
    const result = decodeNqr('not-a-qr');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('BAD_INPUT');
  });

  it('returns BAD_INPUT when merchant info template is missing', () => {
    const qr = encodeTlvForTest('54', '100.00');
    const result = decodeNqr(qr);
    expect(isErr(result)).toBe(true);
  });

  it('returns BAD_INPUT when bank code or account is missing in merchant info', () => {
    const merchantInfoValue = encodeTlvForTest('00', 'NG.NIBSS') + encodeTlvForTest('01', '058');
    const qr = encodeTlvForTest('26', merchantInfoValue);
    const result = decodeNqr(qr);
    expect(isErr(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```powershell
pnpm --filter @amana/backend test tests/modules/vendors/nqr-decoder.test.ts
```

- [ ] **Step 3: Write `apps/backend/src/modules/vendors/nqr-decoder.ts`**

```ts
import { err, ok, type Result } from '../../lib/result';
import { fromNairaString, kobo, type Kobo } from '../../lib/kobo';

export type DecodedNqr = {
  bankCode: string;
  accountNumber: string;
  accountName: string | null;
  amountKobo: Kobo | null;
};

export type NqrError = { code: 'BAD_INPUT'; message: string };

const TAG_MERCHANT_INFO = '26';
const TAG_AMOUNT = '54';
const TAG_ACCOUNT_NAME = '59';
const SUBTAG_BANK_CODE = '01';
const SUBTAG_ACCOUNT_NUMBER = '02';

type TlvMap = Map<string, string>;

function parseTlv(input: string): TlvMap | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < input.length) {
    if (input.length - i < 4) return null;
    const tag = input.slice(i, i + 2);
    const len = Number.parseInt(input.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len) || i + 4 + len > input.length) return null;
    const value = input.slice(i + 4, i + 4 + len);
    out.set(tag, value);
    i += 4 + len;
  }
  return out;
}

export function decodeNqr(qr: string): Result<DecodedNqr, NqrError> {
  const top = parseTlv(qr);
  if (!top) return err({ code: 'BAD_INPUT', message: 'malformed top-level TLV' });

  const merchantInfo = top.get(TAG_MERCHANT_INFO);
  if (!merchantInfo) return err({ code: 'BAD_INPUT', message: 'missing merchant info template (tag 26)' });

  const inner = parseTlv(merchantInfo);
  if (!inner) return err({ code: 'BAD_INPUT', message: 'malformed merchant info template' });

  const bankCode = inner.get(SUBTAG_BANK_CODE);
  const accountNumber = inner.get(SUBTAG_ACCOUNT_NUMBER);
  if (!bankCode) return err({ code: 'BAD_INPUT', message: 'missing bank code (subtag 01)' });
  if (!accountNumber) return err({ code: 'BAD_INPUT', message: 'missing account number (subtag 02)' });

  const amountStr = top.get(TAG_AMOUNT);
  let amountKobo: Kobo | null = null;
  if (amountStr) {
    try {
      amountKobo = fromNairaString(amountStr);
    } catch (e) {
      return err({ code: 'BAD_INPUT', message: `bad amount: ${(e as Error).message}` });
    }
  }

  const accountName = top.get(TAG_ACCOUNT_NAME) ?? null;

  return ok({
    bankCode,
    accountNumber,
    accountName,
    amountKobo,
  });
}

/** Test helper: encode a single TLV. Exported so tests can construct QR strings deterministically. */
export function encodeTlvForTest(tag: string, value: string): string {
  if (tag.length !== 2) throw new Error(`tag must be 2 chars: ${tag}`);
  const len = String(value.length).padStart(2, '0');
  if (len.length !== 2) throw new Error(`value too long for 2-digit length: ${value.length}`);
  return `${tag}${len}${value}`;
}
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/vendors/nqr-decoder.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/nqr-decoder.ts apps/backend/tests/modules/vendors/nqr-decoder.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): NQR decoder (EMV-Co TLV subset for bank code + account + optional amount/name)"
```

---

## Phase C — Vendor capture services (Tasks 4-8)

### Task 4: name-enquiry service

Thin wrapper over `AnchorAdapter.nameEnquiry`. Maps Anchor's response shape to `ResolvedVendor`.

**Files:**
- Create: `apps/backend/src/modules/vendors/name-enquiry.service.ts`
- Create: `apps/backend/tests/modules/vendors/name-enquiry.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { nameEnquiryService } from '../../../src/modules/vendors/name-enquiry.service';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient, AnchorHttpError } from '../../../src/integrations/anchor/client';
import { isErr, isOk } from '../../../src/lib/result';
import { testDb } from '../../helpers/test-db';

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('nameEnquiryService.lookup', () => {
  it('maps Anchor success → ResolvedVendor with source=name_enquiry', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        bankCode: '058', accountNumber: '0123456789', accountName: 'MUSA ABDULLAHI',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await nameEnquiryService.lookup(makeAdapter(fetchSpy), {
      bankCode: '058', accountNumber: '0123456789',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('name_enquiry');
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
      expect(result.value.suggestedAmountKobo).toBeNull();
    }
  });

  it('returns NOT_FOUND on Anchor 404', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } }),
    );
    const result = await nameEnquiryService.lookup(makeAdapter(fetchSpy), {
      bankCode: '058', accountNumber: '9999999999',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns PARTNER_DOWN on Anchor 5xx', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"down"}', { status: 503, headers: { 'content-type': 'application/json' } }),
    );
    const result = await nameEnquiryService.lookup(makeAdapter(fetchSpy), {
      bankCode: '058', accountNumber: '0123456789',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('PARTNER_DOWN');
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/vendors/name-enquiry.service.ts`**

```ts
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import { err, ok, type Result } from '../../lib/result';
import type { ResolvedVendor, ResolveError } from './types';

export const nameEnquiryService = {
  async lookup(
    adapter: AnchorAdapter,
    input: { bankCode: string; accountNumber: string },
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    try {
      const r = await adapter.nameEnquiry({
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
      });
      return ok({
        bankCode: r.bankCode,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        source: 'name_enquiry',
        suggestedAmountKobo: null,
      });
    } catch (e) {
      if (e instanceof AnchorHttpError) {
        if (e.status === 404) return err({ code: 'NOT_FOUND' });
        if (e.status >= 500) return err({ code: 'PARTNER_DOWN' });
        return err({ code: 'BAD_INPUT', message: `Anchor ${e.status}` });
      }
      return err({ code: 'PARTNER_DOWN' });
    }
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/vendors/name-enquiry.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/name-enquiry.service.ts apps/backend/tests/modules/vendors/name-enquiry.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): name-enquiry service (Anchor wrapper, ResolvedVendor mapping)"
```

---

### Task 5: phone-lookup service (Decision #16)

Mirror of name-enquiry, calls `adapter.phoneLookup`.

**Files:**
- Create: `apps/backend/src/modules/vendors/phone-lookup.service.ts`
- Create: `apps/backend/tests/modules/vendors/phone-lookup.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { phoneLookupService } from '../../../src/modules/vendors/phone-lookup.service';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { isErr, isOk } from '../../../src/lib/result';
import { testDb } from '../../helpers/test-db';

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('phoneLookupService.lookup', () => {
  it('maps Anchor success → ResolvedVendor with source=phone_lookup', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        bankCode: '999', accountNumber: '8011112222',
        accountName: 'MUSA ABDULLAHI', phoneNumber: '+2348011112222',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await phoneLookupService.lookup(makeAdapter(fetchSpy), {
      phoneNumber: '+2348011112222',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('phone_lookup');
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
    }
  });

  it('returns NOT_FOUND on Anchor 404', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } }),
    );
    const result = await phoneLookupService.lookup(makeAdapter(fetchSpy), {
      phoneNumber: '+2348099999999',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed phone number with BAD_INPUT', async () => {
    const fetchSpy = vi.fn();
    const result = await phoneLookupService.lookup(makeAdapter(fetchSpy), {
      phoneNumber: 'not-a-phone',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('BAD_INPUT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/vendors/phone-lookup.service.ts`**

```ts
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import { err, ok, type Result } from '../../lib/result';
import type { ResolvedVendor, ResolveError } from './types';

const E164_RE = /^\+\d{10,15}$/;

export const phoneLookupService = {
  async lookup(
    adapter: AnchorAdapter,
    input: { phoneNumber: string },
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    if (!E164_RE.test(input.phoneNumber)) {
      return err({ code: 'BAD_INPUT', message: `phone not in E.164 format: ${input.phoneNumber}` });
    }
    try {
      const r = await adapter.phoneLookup({ phoneNumber: input.phoneNumber });
      return ok({
        bankCode: r.bankCode,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        source: 'phone_lookup',
        suggestedAmountKobo: null,
      });
    } catch (e) {
      if (e instanceof AnchorHttpError) {
        if (e.status === 404) return err({ code: 'NOT_FOUND' });
        if (e.status >= 500) return err({ code: 'PARTNER_DOWN' });
        return err({ code: 'BAD_INPUT', message: `Anchor ${e.status}` });
      }
      return err({ code: 'PARTNER_DOWN' });
    }
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/vendors/phone-lookup.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/phone-lookup.service.ts apps/backend/tests/modules/vendors/phone-lookup.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): phone-lookup service (Decision #16, E.164 validation)"
```

---

### Task 6: sticker-lookup service

Wraps the Sub-plan 2 `stickerResolverService.resolve` — converts its `ResolveError` to the vendors-module shape.

**Files:**
- Create: `apps/backend/src/modules/vendors/sticker-lookup.service.ts`
- Create: `apps/backend/tests/modules/vendors/sticker-lookup.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { stickersRepo } from '../../../src/modules/sticker/stickers.repo';
import { stickerLookupService } from '../../../src/modules/vendors/sticker-lookup.service';
import { isErr, isOk } from '../../../src/lib/result';

describe('stickerLookupService.lookup', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns ResolvedVendor with source=sticker for an active sticker', async () => {
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA ABDULLAHI',
      vendorPhone: factories.phone(),
      status: 'active',
    });
    const result = await stickerLookupService.lookup(testDb, sticker.uuid);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('sticker');
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
    }
  });

  it('NOT_FOUND for unknown sticker', async () => {
    const result = await stickerLookupService.lookup(testDb, factories.txnId());
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('STICKER_UNBOUND for unbound', async () => {
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058', accountNumber: factories.bankAccount(),
      accountName: 'PENDING', vendorPhone: '+0',
      status: 'unbound',
    });
    const result = await stickerLookupService.lookup(testDb, sticker.uuid);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('STICKER_UNBOUND');
  });

  it('STICKER_REVOKED for revoked', async () => {
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058', accountNumber: factories.bankAccount(),
      accountName: 'OLD', vendorPhone: factories.phone(),
      status: 'revoked',
    });
    const result = await stickerLookupService.lookup(testDb, sticker.uuid);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('STICKER_REVOKED');
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/vendors/sticker-lookup.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { stickerResolverService } from '../sticker/sticker-resolver.service';
import { err, isOk, ok, type Result } from '../../lib/result';
import type { ResolvedVendor, ResolveError } from './types';

export const stickerLookupService = {
  async lookup(
    db: PostgresJsDatabase,
    stickerUuid: string,
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    const r = await stickerResolverService.resolve(db, stickerUuid);
    if (isOk(r)) {
      return ok({
        bankCode: r.value.bankCode,
        accountNumber: r.value.accountNumber,
        accountName: r.value.accountName,
        source: 'sticker',
        suggestedAmountKobo: null,
      });
    }
    switch (r.error.code) {
      case 'NOT_FOUND':
        return err({ code: 'NOT_FOUND' });
      case 'UNBOUND':
        return err({ code: 'STICKER_UNBOUND' });
      case 'REVOKED':
        return err({ code: 'STICKER_REVOKED' });
    }
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/vendors/sticker-lookup.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/sticker-lookup.service.ts apps/backend/tests/modules/vendors/sticker-lookup.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): sticker-lookup service (wraps Sub-plan 2 stub, maps errors)"
```

---

### Task 7: recents.repo

**Files:**
- Create: `apps/backend/src/modules/vendors/recents.repo.ts`
- Modify: `apps/backend/tests/modules/vendors/recents.repo.test.ts` (extend the schema-only file)

- [ ] **Step 1: Write `apps/backend/src/modules/vendors/recents.repo.ts`**

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorRecents } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type RecentRow = typeof vendorRecents.$inferSelect;

export type UpsertInput = {
  subWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  now: Date;
};

export const recentsRepo = {
  /** Insert if new; promote (set last_used_at) if already exists. Atomic via INSERT ... ON CONFLICT. */
  async upsert(db: DbOrTx, input: UpsertInput): Promise<RecentRow> {
    const [row] = await db
      .insert(vendorRecents)
      .values({
        subWalletId: input.subWalletId,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
        lastUsedAt: input.now,
        firstSeenAt: input.now,
      })
      .onConflictDoUpdate({
        target: [vendorRecents.subWalletId, vendorRecents.bankCode, vendorRecents.accountNumber],
        set: { lastUsedAt: input.now, accountName: input.accountName },
      })
      .returning();
    if (!row) throw new Error('recents.upsert returned no row');
    return row;
  },

  async listTop(db: DbOrTx, subWalletId: string, limit: number): Promise<RecentRow[]> {
    return db
      .select()
      .from(vendorRecents)
      .where(eq(vendorRecents.subWalletId, subWalletId))
      .orderBy(desc(vendorRecents.lastUsedAt))
      .limit(limit);
  },

  async findByVendor(
    db: DbOrTx,
    subWalletId: string,
    bankCode: string,
    accountNumber: string,
  ): Promise<RecentRow | undefined> {
    const [row] = await db
      .select()
      .from(vendorRecents)
      .where(
        and(
          eq(vendorRecents.subWalletId, subWalletId),
          eq(vendorRecents.bankCode, bankCode),
          eq(vendorRecents.accountNumber, accountNumber),
        ),
      )
      .limit(1);
    return row;
  },

  /** Trim to the top N most-recent entries; delete the older ones. Used by recents.service to bound the table. */
  async trimToLimit(db: DbOrTx, subWalletId: string, keep: number): Promise<number> {
    const result = await db.execute<{ deleted: string }>(sql`
      WITH ranked AS (
        SELECT sub_wallet_id, bank_code, account_number,
               ROW_NUMBER() OVER (PARTITION BY sub_wallet_id ORDER BY last_used_at DESC) AS rn
        FROM vendor_recents
        WHERE sub_wallet_id = ${subWalletId}
      )
      DELETE FROM vendor_recents v
      USING ranked r
      WHERE v.sub_wallet_id = r.sub_wallet_id
        AND v.bank_code = r.bank_code
        AND v.account_number = r.account_number
        AND r.rn > ${keep}
      RETURNING 1
    `);
    return result.length;
  },
};
```

- [ ] **Step 2: Replace `apps/backend/tests/modules/vendors/recents.repo.test.ts`** (extend the schema-only file from Task 1)

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { recentsRepo } from '../../../src/modules/vendors/recents.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedSubWallet(): Promise<string> {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return sw.sub.id;
}

describe('vendor_recents (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_recents' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'sub_wallet_id', 'bank_code', 'account_number',
      'account_name', 'last_used_at', 'first_seen_at',
    ]);
  });
});

describe('recentsRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('upsert inserts new row on first call', async () => {
    const subWalletId = await seedSubWallet();
    const row = await recentsRepo.upsert(testDb, {
      subWalletId, bankCode: '058', accountNumber: '0123456789',
      accountName: 'MUSA', now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(row.accountName).toBe('MUSA');
    expect(row.firstSeenAt.toISOString()).toBe(row.lastUsedAt.toISOString());
  });

  it('upsert promotes existing row (updates last_used_at, keeps first_seen_at)', async () => {
    const subWalletId = await seedSubWallet();
    const t1 = new Date('2026-05-01T10:00:00Z');
    const t2 = new Date('2026-05-03T12:00:00Z');
    const first = await recentsRepo.upsert(testDb, {
      subWalletId, bankCode: '058', accountNumber: '0123456789',
      accountName: 'MUSA', now: t1,
    });
    const second = await recentsRepo.upsert(testDb, {
      subWalletId, bankCode: '058', accountNumber: '0123456789',
      accountName: 'MUSA UPDATED', now: t2,
    });
    expect(second.firstSeenAt.toISOString()).toBe(first.firstSeenAt.toISOString());
    expect(second.lastUsedAt.toISOString()).toBe(t2.toISOString());
    expect(second.accountName).toBe('MUSA UPDATED');
  });

  it('listTop orders by last_used_at desc', async () => {
    const subWalletId = await seedSubWallet();
    await recentsRepo.upsert(testDb, {
      subWalletId, bankCode: '058', accountNumber: '1111111111',
      accountName: 'A', now: new Date('2026-05-01T10:00:00Z'),
    });
    await recentsRepo.upsert(testDb, {
      subWalletId, bankCode: '058', accountNumber: '2222222222',
      accountName: 'B', now: new Date('2026-05-02T10:00:00Z'),
    });
    await recentsRepo.upsert(testDb, {
      subWalletId, bankCode: '058', accountNumber: '3333333333',
      accountName: 'C', now: new Date('2026-05-03T10:00:00Z'),
    });
    const top = await recentsRepo.listTop(testDb, subWalletId, 2);
    expect(top.map((r) => r.accountName)).toEqual(['C', 'B']);
  });

  it('trimToLimit deletes rows beyond N most-recent', async () => {
    const subWalletId = await seedSubWallet();
    for (let i = 0; i < 5; i++) {
      await recentsRepo.upsert(testDb, {
        subWalletId,
        bankCode: '058',
        accountNumber: `${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`,
        accountName: `V${i}`,
        now: new Date(`2026-05-0${i + 1}T10:00:00Z`),
      });
    }
    const deleted = await recentsRepo.trimToLimit(testDb, subWalletId, 3);
    expect(deleted).toBe(2);
    const remaining = await recentsRepo.listTop(testDb, subWalletId, 10);
    expect(remaining.map((r) => r.accountName)).toEqual(['V4', 'V3', 'V2']);
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/vendors/recents.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/recents.repo.ts apps/backend/tests/modules/vendors/recents.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): recents.repo (atomic upsert + listTop + trimToLimit)"
```

---

### Task 8: recents.service

Service composes `recentsRepo.upsert` followed by a `trimToLimit(10)` so the per-sub-wallet recents table never exceeds 10.

**Files:**
- Create: `apps/backend/src/modules/vendors/recents.service.ts`
- Create: `apps/backend/tests/modules/vendors/recents.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { recentsService } from '../../../src/modules/vendors/recents.service';
import { recentsRepo } from '../../../src/modules/vendors/recents.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedSubWallet(): Promise<string> {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return sw.sub.id;
}

describe('recentsService.touch', () => {
  beforeEach(async () => { await truncateAll(); });

  it('caps recents at MAX_RECENTS=10 per sub-wallet', async () => {
    const subWalletId = await seedSubWallet();
    for (let i = 0; i < 12; i++) {
      await recentsService.touch(testDb, {
        subWalletId, bankCode: '058',
        accountNumber: `${String(i).padStart(10, '0')}`,
        accountName: `V${i}`,
        now: new Date(`2026-05-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`),
      });
    }
    const all = await recentsRepo.listTop(testDb, subWalletId, 100);
    expect(all.length).toBeLessThanOrEqual(10);
  });

  it('listTop10 returns at most 10 entries', async () => {
    const subWalletId = await seedSubWallet();
    for (let i = 0; i < 5; i++) {
      await recentsService.touch(testDb, {
        subWalletId, bankCode: '058',
        accountNumber: `${String(i).padStart(10, '0')}`,
        accountName: `V${i}`,
        now: new Date(`2026-05-0${i + 1}T10:00:00Z`),
      });
    }
    const top = await recentsService.listTop10(testDb, subWalletId);
    expect(top).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/vendors/recents.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { recentsRepo, type RecentRow } from './recents.repo';

const MAX_RECENTS = 10;

export type TouchInput = {
  subWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  now: Date;
};

export const recentsService = {
  async touch(db: PostgresJsDatabase, input: TouchInput): Promise<RecentRow> {
    const row = await recentsRepo.upsert(db, input);
    await recentsRepo.trimToLimit(db, input.subWalletId, MAX_RECENTS);
    return row;
  },

  async listTop10(db: PostgresJsDatabase, subWalletId: string): Promise<RecentRow[]> {
    return recentsRepo.listTop(db, subWalletId, MAX_RECENTS);
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/vendors/recents.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/recents.service.ts apps/backend/tests/modules/vendors/recents.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): recents.service (touch + auto-trim to top 10)"
```

---

## Phase D — Unified vendor resolution (Task 9)

### Task 9: vendor-resolution.service

Single entry point. Routes to the right service based on input shape; touches recents on success.

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-resolution.service.ts`
- Create: `apps/backend/tests/modules/vendors/vendor-resolution.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { vendorResolutionService } from '../../../src/modules/vendors/vendor-resolution.service';
import { recentsRepo } from '../../../src/modules/vendors/recents.repo';
import { stickersRepo } from '../../../src/modules/sticker/stickers.repo';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { encodeTlvForTest } from '../../../src/modules/vendors/nqr-decoder';
import { isOk } from '../../../src/lib/result';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

async function seedSubWallet(): Promise<string> {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return sw.sub.id;
}

const baseFetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({
    bankCode: '058', accountNumber: '0123456789', accountName: 'MUSA ABDULLAHI',
  }), { status: 200, headers: { 'content-type': 'application/json' } }),
);

describe('vendorResolutionService.resolve', () => {
  beforeEach(async () => { await truncateAll(); });

  it('account input → name enquiry path', async () => {
    const subWalletId = await seedSubWallet();
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'account', bankCode: '058', accountNumber: '0123456789',
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.source).toBe('name_enquiry');
  });

  it('phone input → phone lookup path', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        bankCode: '999', accountNumber: '8011112222', accountName: 'MUSA',
        phoneNumber: '+2348011112222',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const subWalletId = await seedSubWallet();
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(fetchSpy), {
      kind: 'phone', phoneNumber: '+2348011112222',
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    if (isOk(result)) expect(result.value.source).toBe('phone_lookup');
  });

  it('sticker input → sticker lookup path', async () => {
    const subWalletId = await seedSubWallet();
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058', accountNumber: '0123456789',
      accountName: 'MUSA', vendorPhone: factories.phone(),
      status: 'active',
    });
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'sticker', stickerUuid: sticker.uuid,
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    if (isOk(result)) expect(result.value.source).toBe('sticker');
  });

  it('NQR input → decoded + name enquiry to confirm + source=nqr', async () => {
    const subWalletId = await seedSubWallet();
    const merchantInfo =
      encodeTlvForTest('00', 'NG.NIBSS') +
      encodeTlvForTest('01', '058') +
      encodeTlvForTest('02', '0123456789');
    const qr = encodeTlvForTest('26', merchantInfo);
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'nqr', payload: qr,
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.source).toBe('nqr');
  });

  it('successful resolution touches recents', async () => {
    const subWalletId = await seedSubWallet();
    await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'account', bankCode: '058', accountNumber: '0123456789',
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    const recent = await recentsRepo.findByVendor(testDb, subWalletId, '058', '0123456789');
    expect(recent).toBeDefined();
    expect(recent?.accountName).toBe('MUSA ABDULLAHI');
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/vendors/vendor-resolution.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { err, isOk, ok, type Result } from '../../lib/result';
import { decodeNqr } from './nqr-decoder';
import { nameEnquiryService } from './name-enquiry.service';
import { phoneLookupService } from './phone-lookup.service';
import { stickerLookupService } from './sticker-lookup.service';
import { recentsService } from './recents.service';
import type { ResolvedVendor, ResolveError } from './types';

export type ResolveInput =
  | { kind: 'account'; bankCode: string; accountNumber: string; subWalletId: string; now: Date }
  | { kind: 'phone'; phoneNumber: string; subWalletId: string; now: Date }
  | { kind: 'sticker'; stickerUuid: string; subWalletId: string; now: Date }
  | { kind: 'nqr'; payload: string; subWalletId: string; now: Date };

export const vendorResolutionService = {
  async resolve(
    db: PostgresJsDatabase,
    adapter: AnchorAdapter,
    input: ResolveInput,
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    let result: Result<ResolvedVendor, ResolveError>;

    switch (input.kind) {
      case 'account':
        result = await nameEnquiryService.lookup(adapter, {
          bankCode: input.bankCode, accountNumber: input.accountNumber,
        });
        break;

      case 'phone':
        result = await phoneLookupService.lookup(adapter, { phoneNumber: input.phoneNumber });
        break;

      case 'sticker':
        result = await stickerLookupService.lookup(db, input.stickerUuid);
        break;

      case 'nqr': {
        const decoded = decodeNqr(input.payload);
        if (!isOk(decoded)) return err({ code: 'BAD_INPUT', message: decoded.error.message });
        // Confirm name via Anchor name enquiry; the QR may have provided a name but we trust NIBSS.
        const ne = await nameEnquiryService.lookup(adapter, {
          bankCode: decoded.value.bankCode,
          accountNumber: decoded.value.accountNumber,
        });
        if (!isOk(ne)) return ne;
        result = ok({
          ...ne.value,
          source: 'nqr',
          suggestedAmountKobo: decoded.value.amountKobo,
        });
        break;
      }
    }

    if (isOk(result)) {
      await recentsService.touch(db, {
        subWalletId: input.subWalletId,
        bankCode: result.value.bankCode,
        accountNumber: result.value.accountNumber,
        accountName: result.value.accountName,
        now: input.now,
      });
    }

    return result;
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/vendors/vendor-resolution.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/vendors/vendor-resolution.service.ts apps/backend/tests/modules/vendors/vendor-resolution.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(vendors): vendor-resolution.service (unified entry, touches recents on success)"
```

---

## Phase E — Transaction intent service (Tasks 10-11)

### Task 10: txn-intent.service.create

Creates a `DRAFT` transaction from an agent's confirmed intent. Caller is responsible for: vendor already resolved, idempotency key chosen client-side.

**Files:**
- Create: `apps/backend/src/modules/transactions/txn-intent.service.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/transactions/txn-intent.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactionsRepo, type TransactionRow } from '../wallet/transactions.repo';
import type { Kobo } from '../../lib/kobo';

export type CreateIntentInput = {
  masterWalletId: string;
  /** null means principal-direct spend per Decision #17. */
  subWalletId: string | null;
  amountKobo: Kobo;
  idempotencyKey: string;
  vendorBankCode: string;
  vendorAccountNumber: string;
  vendorResolvedName: string;
  category: string | null;
  agentNote: string | null;
};

export const txnIntentService = {
  async create(db: PostgresJsDatabase, input: CreateIntentInput): Promise<TransactionRow> {
    return transactionsRepo.insert(db, {
      masterWalletId: input.masterWalletId,
      subWalletId: input.subWalletId,
      kind: 'spend',
      amountKobo: input.amountKobo,
      idempotencyKey: input.idempotencyKey,
      vendorBankCode: input.vendorBankCode,
      vendorAccount: input.vendorAccountNumber,
      vendorResolvedName: input.vendorResolvedName,
      category: input.category,
      agentNote: input.agentNote,
    });
  },
};
```

- [ ] **Step 2: Verify + commit (test in T11)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/txn-intent.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): txn-intent.service.create (creates DRAFT spend with vendor + idempotency key)"
```

---

### Task 11: txn-intent.service tests

**Files:**
- Create: `apps/backend/tests/modules/transactions/txn-intent.service.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return { masterId: mw.master.id, subWalletId: sw.sub.id };
}

describe('txnIntentService.create', () => {
  beforeEach(async () => { await truncateAll(); });

  it('creates a DRAFT spend with all vendor fields', async () => {
    const { masterId, subWalletId } = await seedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId, subWalletId,
      amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccountNumber: '0123456789',
      vendorResolvedName: 'MUSA ABDULLAHI',
      category: 'groceries', agentNote: 'fix tyre',
    });
    expect(txn.status).toBe('draft');
    expect(txn.kind).toBe('spend');
    expect(txn.vendorBankCode).toBe('058');
    expect(txn.category).toBe('groceries');
    expect(txn.agentNote).toBe('fix tyre');
  });

  it('creates a principal-direct DRAFT (subWalletId=null)', async () => {
    const { masterId } = await seedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId, subWalletId: null,
      amountKobo: kobo(50_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccountNumber: '0123456789',
      vendorResolvedName: 'MUSA',
      category: null, agentNote: null,
    });
    expect(txn.subWalletId).toBeNull();
  });

  it('rejects duplicate idempotency keys (DB unique constraint)', async () => {
    const { masterId, subWalletId } = await seedSubWallet();
    const key = factories.idempotencyKey();
    await txnIntentService.create(testDb, {
      masterWalletId: masterId, subWalletId,
      amountKobo: kobo(100n), idempotencyKey: key,
      vendorBankCode: '058', vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M',
      category: null, agentNote: null,
    });
    await expect(
      txnIntentService.create(testDb, {
        masterWalletId: masterId, subWalletId,
        amountKobo: kobo(100n), idempotencyKey: key,
        vendorBankCode: '058', vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M',
        category: null, agentNote: null,
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/txn-intent.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/txn-intent.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): txn-intent.service.create coverage"
```

---

## Phase F — NIP-out service (Tasks 12-13)

### Task 12: nip-out.service.send

Reserves funds in the ledger (debit sub-wallet OR master if principal-direct, credit suspense), then calls Anchor's transfer endpoint with idempotency key. The transaction stays in `IN_FLIGHT` afterwards; the webhook handler (Phase G/H) will finalise it.

**Files:**
- Create: `apps/backend/src/modules/transactions/nip-out.service.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/transactions/nip-out.service.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { selectNarration } from '../../integrations/anchor/narration';
import type { AnchorTransferResponse } from '../../integrations/anchor/types';
import { kobo, type Kobo } from '../../lib/kobo';
import { masterWallets } from '../../db/schema';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export type SendInput = {
  transactionId: string;
  /** household ref used in the NIP narration; usually the household id or a short slug. */
  householdRef: string;
  now: Date;
};

export type SendOutput = {
  anchorTransferId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
};

export const nipOutService = {
  async send(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: SendInput,
  ): Promise<SendOutput> {
    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn) throw new Error(`transaction not found: ${input.transactionId}`);
    if (txn.status !== 'in_flight') {
      throw new Error(`transaction not in_flight: status=${txn.status}`);
    }
    if (!txn.vendorBankCode || !txn.vendorAccount) {
      throw new Error(`transaction missing vendor bank/account: ${txn.id}`);
    }

    // Resolve ledger accounts:
    //   source = sub-wallet ledger account (or master if principal-direct)
    //   sink   = suspense (per spec §6 step 5)
    const masterLA = await ledgerAccountsRepo.findByMasterAndKind(db, txn.masterWalletId, 'master');
    const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(db, txn.masterWalletId, 'suspense');
    if (!masterLA || !suspenseLA) {
      throw new Error('master_wallet missing master/suspense LAs — should not happen');
    }

    const sourceLA = txn.subWalletId
      ? await ledgerAccountsRepo.findBySubWallet(db, txn.subWalletId)
      : masterLA;
    if (!sourceLA) throw new Error('source ledger account missing');

    // Phase 1: write reservation postings (atomic, balanced).
    const amount = kobo(txn.amountKobo as bigint);
    await ledgerService.writeDoubleEntry(db, txn.id, [
      { ledgerAccountId: sourceLA.id, debitKobo: amount, creditKobo: kobo(0n) },
      { ledgerAccountId: suspenseLA.id, debitKobo: kobo(0n), creditKobo: amount },
    ]);

    // Look up the master wallet's anchor virtual account ID for the from-side of the transfer.
    const [mw] = await db.select().from(masterWallets).where(eq(masterWallets.id, txn.masterWalletId)).limit(1);
    if (!mw) throw new Error(`master_wallet ${txn.masterWalletId} disappeared`);

    // Phase 2: call Anchor.
    const narration = selectNarration({
      householdRef: input.householdRef,
      // For principal-direct (subWalletId null), narration uses simpler form.
      agentUserId: txn.subWalletId ? `sub:${txn.subWalletId}` : null,
    });

    const response: AnchorTransferResponse = await adapter.transfer(
      {
        amountKobo: amount,
        fromAccountId: mw.anchorVirtualAccount, // Anchor uses account ID; this is its identifier in our wallet record
        toBankCode: txn.vendorBankCode,
        toAccountNumber: txn.vendorAccount,
        narration,
        reference: txn.idempotencyKey,
      },
      txn.idempotencyKey,
    );

    if (response.nibssSessionId) {
      await transactionsRepo.setNibssSessionId(db, txn.id, response.nibssSessionId);
    }

    return { anchorTransferId: response.id, status: response.status };
  },
};
```

- [ ] **Step 2: Verify + commit (test in T13)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/nip-out.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): nip-out.service.send (reservation postings + Anchor transfer call)"
```

---

### Task 13: nip-out.service tests

**Files:**
- Create: `apps/backend/tests/modules/transactions/nip-out.service.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedFundedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  // Top up sub-wallet with 100K kobo
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  return {
    masterId: mw.master.id, subWalletId: sw.sub.id,
    subLA: sw.ledgerAccountId, suspenseLA: mw.ledgerAccountIds.suspense,
    householdId: hh.id,
  };
}

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('nipOutService.send', () => {
  beforeEach(async () => { await truncateAll(); });

  it('writes reservation postings (debit sub, credit suspense) and calls Anchor with idempotency key', async () => {
    const { masterId, subWalletId, subLA, suspenseLA, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId, subWalletId,
      amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M', category: null, agentNote: null,
    });
    await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'tr-1', status: 'PENDING', reference: txn.idempotencyKey, nibssSessionId: '12345',
      }), { status: 202, headers: { 'content-type': 'application/json' } }),
    );

    const result = await nipOutService.send(testDb, makeAdapter(fetchSpy), {
      transactionId: txn.id, householdRef: householdId, now: new Date('2026-05-03T12:00:00Z'),
    });

    expect(result.status).toBe('PENDING');
    // Reservation: sub-wallet has -5000 (debit not yet offset by suspense settle)
    const subBal = await postingsRepo.accountBalance(testDb, subLA);
    expect(subBal).toBe(95_000n); // 100K topup - 5K reservation
    // Suspense holds the in-flight 5K
    const suspBal = await postingsRepo.accountBalance(testDb, suspenseLA);
    // Suspense had +100K from topup credit; now another -5K from reservation credit; net debit 5K below
    // accountBalance returns SUM(debit - credit). Suspense received credits = 100K + 5K, no debits.
    // So balance = 0 - 105K = -105K
    expect(suspBal).toBe(-105_000n);

    // Anchor called with idempotency key
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(txn.idempotencyKey);

    // NIBSS session id persisted
    const updated = await transactionsRepo.findById(testDb, txn.id);
    expect(updated?.nibssSessionId).toBe('12345');
  });

  it('rejects when transaction is not in in_flight status', async () => {
    const { masterId, subWalletId, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId, subWalletId,
      amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M', category: null, agentNote: null,
    });
    // status is 'draft', not 'in_flight'
    const fetchSpy = vi.fn();
    await expect(
      nipOutService.send(testDb, makeAdapter(fetchSpy), {
        transactionId: txn.id, householdRef: householdId, now: new Date(),
      }),
    ).rejects.toThrow(/not in_flight/);
  });

  it('handles principal-direct spend (subWalletId=null) by debiting master directly', async () => {
    const { masterId, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId, subWalletId: null,
      amountKobo: kobo(2_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M', category: null, agentNote: null,
    });
    await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'tr-2', status: 'PENDING', reference: txn.idempotencyKey }),
        { status: 202, headers: { 'content-type': 'application/json' } }),
    );

    const result = await nipOutService.send(testDb, makeAdapter(fetchSpy), {
      transactionId: txn.id, householdRef: householdId, now: new Date(),
    });
    expect(result.status).toBe('PENDING');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/nip-out.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/nip-out.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): nip-out.service.send (reservation balances + idempotency + principal-direct)"
```

---

## Phase G — Settlement service (Tasks 14-15)

### Task 14: settlement.service.finalise

Called from the `transfer.completed` webhook handler. Moves the transaction from `IN_FLIGHT` to `SETTLED`: posts the suspense → external transfer (debit suspense to clear, credit external) and books a fee posting separately.

**Files:**
- Create: `apps/backend/src/modules/transactions/settlement.service.ts`

The fee at MVP is a flat ₦25 (= 2500 kobo) per outbound NIP, per Decision #10. We post it as a SEPARATE transaction (kind=`fee`) referencing the same idempotency key family — `<txn-id>-fee`.

- [ ] **Step 1: Write `apps/backend/src/modules/transactions/settlement.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { kobo } from '../../lib/kobo';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export const NIP_FEE_KOBO = 2500n; // ₦25 per outbound NIP, Decision #10

export type FinaliseInput = {
  transactionId: string;
  nibssSessionId: string | null;
  settledAt: Date;
};

export const settlementService = {
  async finalise(db: DbOrTx, input: FinaliseInput): Promise<void> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const txn = await transactionsRepo.findById(txDb, input.transactionId);
      if (!txn) throw new Error(`transaction ${input.transactionId} not found`);
      if (txn.status === 'settled') return; // idempotent: webhook may fire twice
      if (txn.status !== 'in_flight') {
        throw new Error(`cannot settle txn in status ${txn.status}`);
      }

      const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, txn.masterWalletId, 'suspense');
      const externalLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, txn.masterWalletId, 'external');
      const feeLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, txn.masterWalletId, 'fee');
      if (!suspenseLA || !feeLA) {
        throw new Error('master wallet missing suspense or fee ledger account');
      }
      // External LA may not exist for older masters provisioned before T19 of Sub-plan 2;
      // create on the fly if missing.
      let extLA = externalLA;
      if (!extLA) {
        extLA = await ledgerAccountsRepo.insert(txDb, {
          masterWalletId: txn.masterWalletId, kind: 'external', normalSide: 'credit',
        });
      }

      // Settle: clear the suspense (debit it), credit external (money left the building).
      const amount = kobo(txn.amountKobo as bigint);
      await ledgerService.writeDoubleEntry(txDb, txn.id, [
        { ledgerAccountId: suspenseLA.id, debitKobo: amount, creditKobo: kobo(0n) },
        { ledgerAccountId: extLA.id, debitKobo: kobo(0n), creditKobo: amount },
      ]);

      // Book the fee as a separate transaction so postings audit trail stays clean.
      const feeTxn = await transactionsRepo.insert(txDb, {
        masterWalletId: txn.masterWalletId,
        subWalletId: txn.subWalletId,
        kind: 'fee',
        amountKobo: kobo(NIP_FEE_KOBO),
        idempotencyKey: `${txn.id}-fee`,
      });
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, txn.masterWalletId, 'master');
      if (!masterLA) throw new Error('master LA missing');
      await ledgerService.writeDoubleEntry(txDb, feeTxn.id, [
        { ledgerAccountId: masterLA.id, debitKobo: kobo(0n), creditKobo: kobo(NIP_FEE_KOBO) },
        { ledgerAccountId: feeLA.id, debitKobo: kobo(NIP_FEE_KOBO), creditKobo: kobo(0n) },
      ]);
      await transactionsRepo.setStatus(txDb, feeTxn.id, 'settled', input.settledAt);

      // Mark the spend txn settled.
      if (input.nibssSessionId) {
        await transactionsRepo.setNibssSessionId(txDb, txn.id, input.nibssSessionId);
      }
      await transactionsRepo.setStatus(txDb, txn.id, 'settled', input.settledAt);
    });
  },
};
```

- [ ] **Step 2: Verify + commit (test in T15)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/settlement.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): settlement.service.finalise (clear suspense + book fee + status=settled)"
```

---

### Task 15: settlement.service tests

**Files:**
- Create: `apps/backend/tests/modules/transactions/settlement.service.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { settlementService, NIP_FEE_KOBO } from '../../../src/modules/transactions/settlement.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedAndSendNip() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  const txn = await txnIntentService.create(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058', vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M', category: null, agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tr-1', status: 'PENDING', reference: txn.idempotencyKey }),
      { status: 202, headers: { 'content-type': 'application/json' } }),
  );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  await nipOutService.send(testDb, adapter, {
    transactionId: txn.id, householdRef: hh.id, now: new Date('2026-05-03T12:00:00Z'),
  });
  return {
    txnId: txn.id, masterId: mw.master.id,
    feeLA: mw.ledgerAccountIds.fee, masterLA: mw.ledgerAccountIds.master,
    subLA: sw.ledgerAccountId, suspenseLA: mw.ledgerAccountIds.suspense,
  };
}

describe('settlementService.finalise', () => {
  beforeEach(async () => { await truncateAll(); });

  it('moves txn to settled + books NIP fee + clears suspense', async () => {
    const { txnId, feeLA, masterLA, suspenseLA } = await seedAndSendNip();
    const settledAt = new Date('2026-05-03T12:00:30Z');
    await settlementService.finalise(testDb, {
      transactionId: txnId, nibssSessionId: '99999', settledAt,
    });
    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
    expect(settled?.settledAt?.toISOString()).toBe(settledAt.toISOString());
    expect(settled?.nibssSessionId).toBe('99999');

    // Fee LA accumulated NIP_FEE_KOBO debits (fee is a debit-side asset for us)
    const feeBal = await postingsRepo.accountBalance(testDb, feeLA);
    expect(feeBal).toBe(NIP_FEE_KOBO);

    // Suspense balance net should reflect the cleared in-flight.
    // After topup: suspense received 100K credits (balance -100K via debit-credit).
    // After spend reservation: another 5K credit (balance -105K).
    // After settle: 5K debit on suspense (balance -100K) + master also took the fee credit (separately).
    const suspBal = await postingsRepo.accountBalance(testDb, suspenseLA);
    expect(suspBal).toBe(-100_000n);
  });

  it('is idempotent — second call on already-settled txn is a no-op', async () => {
    const { txnId } = await seedAndSendNip();
    await settlementService.finalise(testDb, {
      transactionId: txnId, nibssSessionId: '1', settledAt: new Date('2026-05-03T12:00:30Z'),
    });
    // Second call should NOT throw and NOT double-book the fee.
    await settlementService.finalise(testDb, {
      transactionId: txnId, nibssSessionId: '1', settledAt: new Date('2026-05-03T12:00:31Z'),
    });
    // Still only one settled spend
    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
  });

  it('rejects settle on a non-in_flight transaction', async () => {
    const { txnId } = await seedAndSendNip();
    await transactionsRepo.setStatus(testDb, txnId, 'failed');
    await expect(
      settlementService.finalise(testDb, {
        transactionId: txnId, nibssSessionId: null, settledAt: new Date(),
      }),
    ).rejects.toThrow(/cannot settle/);
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/settlement.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/settlement.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): settlement.service.finalise (settled + fee + idempotent + status guard)"
```

---

## Phase H — Reversal service (Tasks 16-17)

### Task 16: reversal.service.reverse

Called from the `transfer.failed` webhook handler. Mirrors the reservation postings back (debit suspense, credit source) and sets txn.status=`failed`.

**Files:**
- Create: `apps/backend/src/modules/transactions/reversal.service.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/transactions/reversal.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { kobo } from '../../lib/kobo';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export type ReverseInput = {
  transactionId: string;
  /** Optional human-readable reason from Anchor; persisted via narration if needed (audit log later). */
  reason: string | null;
  failedAt: Date;
};

export const reversalService = {
  async reverse(db: DbOrTx, input: ReverseInput): Promise<void> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const txn = await transactionsRepo.findById(txDb, input.transactionId);
      if (!txn) throw new Error(`transaction ${input.transactionId} not found`);
      if (txn.status === 'failed') return; // idempotent
      if (txn.status !== 'in_flight') {
        throw new Error(`cannot reverse txn in status ${txn.status}`);
      }

      const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, txn.masterWalletId, 'suspense');
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, txn.masterWalletId, 'master');
      if (!suspenseLA || !masterLA) {
        throw new Error('master wallet missing suspense/master LAs');
      }
      const sourceLA = txn.subWalletId
        ? await ledgerAccountsRepo.findBySubWallet(txDb, txn.subWalletId)
        : masterLA;
      if (!sourceLA) throw new Error('source ledger account missing');

      // Mirror the reservation: debit suspense, credit source — restoring the source balance.
      const amount = kobo(txn.amountKobo as bigint);

      // Use a SEPARATE reversal transaction to keep the original txn's postings immutable + paired.
      const reversalTxn = await transactionsRepo.insert(txDb, {
        masterWalletId: txn.masterWalletId,
        subWalletId: txn.subWalletId,
        kind: 'reversal',
        amountKobo: amount,
        idempotencyKey: `${txn.id}-reverse`,
      });
      await ledgerService.writeDoubleEntry(txDb, reversalTxn.id, [
        { ledgerAccountId: suspenseLA.id, debitKobo: amount, creditKobo: kobo(0n) },
        { ledgerAccountId: sourceLA.id, debitKobo: kobo(0n), creditKobo: amount },
      ]);
      await transactionsRepo.setStatus(txDb, reversalTxn.id, 'settled', input.failedAt);

      // Mark original txn failed.
      await transactionsRepo.setStatus(txDb, txn.id, 'failed', input.failedAt);
    });
  },
};
```

- [ ] **Step 2: Verify + commit (test in T17)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/reversal.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): reversal.service.reverse (separate reversal txn restores source balance)"
```

---

### Task 17: reversal.service tests

**Files:**
- Create: `apps/backend/tests/modules/transactions/reversal.service.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { reversalService } from '../../../src/modules/transactions/reversal.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedAndSendNip() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  const txn = await txnIntentService.create(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058', vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M', category: null, agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tr-1', status: 'PENDING', reference: txn.idempotencyKey }),
      { status: 202, headers: { 'content-type': 'application/json' } }),
  );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  await nipOutService.send(testDb, adapter, {
    transactionId: txn.id, householdRef: hh.id, now: new Date('2026-05-03T12:00:00Z'),
  });
  return { txnId: txn.id, subLA: sw.ledgerAccountId };
}

describe('reversalService.reverse', () => {
  beforeEach(async () => { await truncateAll(); });

  it('marks txn failed and restores source balance', async () => {
    const { txnId, subLA } = await seedAndSendNip();
    // Before reverse: sub-wallet should have 100K - 5K = 95K
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(95_000n);

    await reversalService.reverse(testDb, {
      transactionId: txnId, reason: 'insufficient funds at recipient',
      failedAt: new Date('2026-05-03T12:01:00Z'),
    });

    const failed = await transactionsRepo.findById(testDb, txnId);
    expect(failed?.status).toBe('failed');
    // After reverse: sub-wallet balance restored to 100K
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });

  it('is idempotent — second call on already-failed txn is a no-op', async () => {
    const { txnId, subLA } = await seedAndSendNip();
    await reversalService.reverse(testDb, {
      transactionId: txnId, reason: null, failedAt: new Date('2026-05-03T12:01:00Z'),
    });
    await reversalService.reverse(testDb, {
      transactionId: txnId, reason: null, failedAt: new Date('2026-05-03T12:01:30Z'),
    });
    // Sub-wallet should still be 100K (not double-restored to 105K).
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/reversal.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/reversal.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): reversal.service.reverse (failed + balance restored + idempotent)"
```

---

## Phase I — Topup service (Tasks 18-19)

Inbound NIP credits to the master virtual account land here via the `virtual_account.credited` webhook. The topup creates a new `kind=topup` transaction and posts the credit (debit master, credit external).

### Task 18: topup.service.handle

**Files:**
- Create: `apps/backend/src/modules/transactions/topup.service.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/transactions/topup.service.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { masterWallets } from '../../db/schema';
import { kobo, type Kobo } from '../../lib/kobo';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export type HandleTopupInput = {
  /** Anchor virtual account ID that received the credit. We resolve master_wallet by this. */
  virtualAccountId: string;
  amountKobo: Kobo;
  nibssSessionId: string;
  senderBankCode: string;
  senderAccountNumber: string;
  senderAccountName: string;
  receivedAt: Date;
};

export type HandleTopupResult =
  | { kind: 'created'; transactionId: string }
  | { kind: 'duplicate'; transactionId: string }
  | { kind: 'unknown_account' };

export const topupService = {
  async handle(db: DbOrTx, input: HandleTopupInput): Promise<HandleTopupResult> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const [mw] = await txDb
        .select()
        .from(masterWallets)
        .where(eq(masterWallets.anchorVirtualAccount, input.virtualAccountId))
        .limit(1);
      if (!mw) return { kind: 'unknown_account' as const };

      const idempotencyKey = `topup:${input.nibssSessionId}`;

      // Idempotency: if we've already booked this NIP session ID as a topup, short-circuit.
      const existing = await transactionsRepo.findByIdempotencyKey(txDb, idempotencyKey);
      if (existing) {
        return { kind: 'duplicate' as const, transactionId: existing.id };
      }

      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, mw.id, 'master');
      let externalLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, mw.id, 'external');
      if (!masterLA) throw new Error('master LA missing');
      if (!externalLA) {
        externalLA = await ledgerAccountsRepo.insert(txDb, {
          masterWalletId: mw.id, kind: 'external', normalSide: 'credit',
        });
      }

      const txn = await transactionsRepo.insert(txDb, {
        masterWalletId: mw.id,
        kind: 'topup',
        amountKobo: input.amountKobo,
        idempotencyKey,
      });
      await transactionsRepo.setNibssSessionId(txDb, txn.id, input.nibssSessionId);

      // Topup posting: debit master (we now hold more), credit external (money came from outside).
      await ledgerService.writeDoubleEntry(txDb, txn.id, [
        { ledgerAccountId: masterLA.id, debitKobo: input.amountKobo, creditKobo: kobo(0n) },
        { ledgerAccountId: externalLA.id, debitKobo: kobo(0n), creditKobo: input.amountKobo },
      ]);

      await transactionsRepo.setStatus(txDb, txn.id, 'settled', input.receivedAt);
      return { kind: 'created' as const, transactionId: txn.id };
    });
  },
};
```

- [ ] **Step 2: Verify + commit (test in T19)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/topup.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): topup.service.handle (inbound NIP credit → master ledger debit, idempotent on session id)"
```

---

### Task 19: topup.service tests

**Files:**
- Create: `apps/backend/tests/modules/transactions/topup.service.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { topupService } from '../../../src/modules/transactions/topup.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';

async function seedMaster() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '9999000099', anchorBankCode: '058',
  });
  return { masterId: mw.master.id, masterLA: mw.ledgerAccountIds.master, va: '9999000099' };
}

describe('topupService.handle', () => {
  beforeEach(async () => { await truncateAll(); });

  it('books the credit + master LA gains the amount', async () => {
    const { masterLA, va } = await seedMaster();
    const result = await topupService.handle(testDb, {
      virtualAccountId: va,
      amountKobo: kobo(50_000n),
      nibssSessionId: '111222333',
      senderBankCode: '058', senderAccountNumber: '0001112223', senderAccountName: 'SENDER',
      receivedAt: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('created');
    const bal = await postingsRepo.accountBalance(testDb, masterLA);
    expect(bal).toBe(50_000n);
  });

  it('idempotent on nibss session id (replay returns duplicate)', async () => {
    const { masterLA, va } = await seedMaster();
    await topupService.handle(testDb, {
      virtualAccountId: va, amountKobo: kobo(50_000n), nibssSessionId: 'abc',
      senderBankCode: '058', senderAccountNumber: '0001112223', senderAccountName: 'SENDER',
      receivedAt: new Date('2026-05-03T12:00:00Z'),
    });
    const second = await topupService.handle(testDb, {
      virtualAccountId: va, amountKobo: kobo(50_000n), nibssSessionId: 'abc',
      senderBankCode: '058', senderAccountNumber: '0001112223', senderAccountName: 'SENDER',
      receivedAt: new Date('2026-05-03T12:00:30Z'),
    });
    expect(second.kind).toBe('duplicate');
    // Master balance is still 50K, not 100K.
    expect(await postingsRepo.accountBalance(testDb, masterLA)).toBe(50_000n);
  });

  it('returns unknown_account when no master_wallet matches the virtual account', async () => {
    const result = await topupService.handle(testDb, {
      virtualAccountId: '0000000000', amountKobo: kobo(1n), nibssSessionId: 'x',
      senderBankCode: '058', senderAccountNumber: '0', senderAccountName: 'X',
      receivedAt: new Date(),
    });
    expect(result.kind).toBe('unknown_account');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/topup.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/topup.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): topup.service.handle (credit booked + idempotent + unknown account)"
```

---

## Phase J — Reconciliation (Tasks 20-21)

### Task 20: reconciliation.service.sweep

For any txn in `IN_FLIGHT > 5 min`, query Anchor's transfer-status endpoint by idempotency key, then finalise via `settlement.service` or `reversal.service`. Returns counts.

**Files:**
- Create: `apps/backend/src/modules/transactions/reconciliation.service.ts`

We need a new method on the Anchor adapter to query transfer status. Add it inline in the same task — minimal scope.

- [ ] **Step 1: Append `findTransferByReference` to `apps/backend/src/integrations/anchor/adapter.ts`**

Inside the `AnchorAdapter` class, after `phoneLookup`:

```ts
  async findTransferByReference(
    reference: string,
  ): Promise<import('./types').AnchorTransferResponse | null> {
    const qs = `?reference=${encodeURIComponent(reference)}`;
    try {
      return await this.breaker.exec(() =>
        this.executeWithRetry(() =>
          this.client.get<import('./types').AnchorTransferResponse>(`/transfers/by-reference${qs}`),
        ),
      );
    } catch (e) {
      if (e instanceof (await import('./client')).AnchorHttpError && e.status === 404) {
        return null;
      }
      throw e;
    }
  }
```

(For the dynamic import: we can also just `import { AnchorHttpError } from './client'` at the top of the file and use it directly. The dynamic form keeps imports concise; pick whichever passes typecheck.)

- [ ] **Step 2: Write `apps/backend/src/modules/transactions/reconciliation.service.ts`**

```ts
import { and, eq, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { settlementService } from './settlement.service';
import { reversalService } from './reversal.service';

type DbOrTx = PostgresJsDatabase;

const STUCK_THRESHOLD_MINUTES = 5;

export type SweepResult = {
  inspected: number;
  settled: number;
  reversed: number;
  stillPending: number;
  unknown: number;
};

export const reconciliationService = {
  async sweep(
    db: DbOrTx,
    adapter: AnchorAdapter,
    now: Date,
  ): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60 * 1000);
    const stuck = await db
      .select({
        id: transactions.id,
        idempotencyKey: transactions.idempotencyKey,
        kind: transactions.kind,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'in_flight'),
          eq(transactions.kind, 'spend'),
          lt(transactions.createdAt, cutoff),
        ),
      );

    let settled = 0;
    let reversed = 0;
    let stillPending = 0;
    let unknown = 0;

    for (const row of stuck) {
      const remote = await adapter.findTransferByReference(row.idempotencyKey);
      if (remote === null) {
        unknown += 1;
        continue;
      }
      if (remote.status === 'COMPLETED') {
        await settlementService.finalise(db, {
          transactionId: row.id,
          nibssSessionId: remote.nibssSessionId ?? null,
          settledAt: now,
        });
        settled += 1;
      } else if (remote.status === 'FAILED') {
        await reversalService.reverse(db, {
          transactionId: row.id,
          reason: remote.failureReason ?? null,
          failedAt: now,
        });
        reversed += 1;
      } else {
        stillPending += 1;
      }
    }

    return { inspected: stuck.length, settled, reversed, stillPending, unknown };
  },
};
```

- [ ] **Step 3: Commit (test in T21)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/integrations/anchor/adapter.ts apps/backend/src/modules/transactions/reconciliation.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): reconciliation.service.sweep + adapter.findTransferByReference"
```

---

### Task 21: reconciliation.service tests + standalone runner script

**Files:**
- Create: `apps/backend/tests/modules/transactions/reconciliation.service.test.ts`
- Create: `apps/backend/scripts/recon-runner.ts`

- [ ] **Step 1: Write tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { reconciliationService } from '../../../src/modules/transactions/reconciliation.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { sql } from 'drizzle-orm';
import { transactions } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

async function seedStuckTxn(createdAtIso: string) {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  // Top up
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  // Create spend, force into in_flight, BACKDATE created_at to make it look stuck
  const txn = await txnIntentService.create(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058', vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M', category: null, agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  // Reservation postings (so settlement doesn't fail later)
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(5_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(5_000n) },
  ]);
  // Backdate
  await testDb.execute(sql`UPDATE transactions SET created_at = ${createdAtIso}::timestamptz WHERE id = ${txn.id}`);
  return { txnId: txn.id, idempotencyKey: txn.idempotencyKey };
}

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('reconciliationService.sweep', () => {
  beforeEach(async () => { await truncateAll(); });

  it('settles stuck txns when Anchor reports COMPLETED', async () => {
    const { txnId, idempotencyKey } = await seedStuckTxn('2026-05-03T11:50:00Z');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'tr-1', status: 'COMPLETED', reference: idempotencyKey, nibssSessionId: '777',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await reconciliationService.sweep(testDb, makeAdapter(fetchSpy), new Date('2026-05-03T12:00:00Z'));
    expect(result.settled).toBe(1);
    const finalTxn = await transactionsRepo.findById(testDb, txnId);
    expect(finalTxn?.status).toBe('settled');
  });

  it('reverses stuck txns when Anchor reports FAILED', async () => {
    const { txnId, idempotencyKey } = await seedStuckTxn('2026-05-03T11:50:00Z');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'tr-1', status: 'FAILED', reference: idempotencyKey, failureReason: 'recipient closed',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await reconciliationService.sweep(testDb, makeAdapter(fetchSpy), new Date('2026-05-03T12:00:00Z'));
    expect(result.reversed).toBe(1);
    const finalTxn = await transactionsRepo.findById(testDb, txnId);
    expect(finalTxn?.status).toBe('failed');
  });

  it('counts unknown when Anchor returns 404 for the reference', async () => {
    await seedStuckTxn('2026-05-03T11:50:00Z');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } }),
    );
    const result = await reconciliationService.sweep(testDb, makeAdapter(fetchSpy), new Date('2026-05-03T12:00:00Z'));
    expect(result.unknown).toBe(1);
  });

  it('skips fresh in_flight txns (under 5 minutes old)', async () => {
    await seedStuckTxn(new Date('2026-05-03T11:58:00Z').toISOString());
    const fetchSpy = vi.fn();
    const result = await reconciliationService.sweep(testDb, makeAdapter(fetchSpy), new Date('2026-05-03T12:00:00Z'));
    expect(result.inspected).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `apps/backend/scripts/recon-runner.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { db } from '../src/db/client';
import { reconciliationService } from '../src/modules/transactions/reconciliation.service';
import { AnchorAdapter } from '../src/integrations/anchor/adapter';
import { AnchorClient } from '../src/integrations/anchor/client';
import { env } from '../src/env';

async function main() {
  const adapter = new AnchorAdapter({
    db,
    client: new AnchorClient({ baseUrl: env.ANCHOR_API_BASE_URL, apiKey: env.ANCHOR_API_KEY }),
  });
  const result = await reconciliationService.sweep(db, adapter, new Date());
  // biome-ignore lint/suspicious/noConsoleLog: this is a CLI tool — log is the expected interface
  console.log(JSON.stringify({ kind: 'recon-result', ...result }));
  if (result.unknown > 0) {
    console.warn(`recon: ${result.unknown} txns had unknown remote state — investigate manually`);
  }
}

main().catch((e) => {
  console.error('recon-runner failed:', e);
  process.exit(1);
}).finally(() => process.exit(0));

void dirname;
void resolve;
void fileURLToPath; // keep imports for future path-resolution needs
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/reconciliation.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/reconciliation.service.test.ts apps/backend/scripts/recon-runner.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): reconciliation.service.sweep + recon-runner.ts CLI script"
```

---

## Phase K — Webhook router extension (Tasks 22-23)

The Sub-plan 2 `/webhooks/anchor` route only audit-logs. Now extend it to dispatch by `event.type` to the right handler.

### Task 22: Extend webhook handler

**Files:**
- Modify: `apps/backend/src/routes/webhooks.ts`

- [ ] **Step 1: Replace `apps/backend/src/routes/webhooks.ts`**

Read the existing file first. Then replace it with the extended version that, after audit-logging, dispatches to handlers:

```ts
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog } from '../db/schema';
import { env } from '../env';
import { logger } from '../lib/logger';
import { kobo } from '../lib/kobo';
import { parseAndVerifyWebhook, WebhookSignatureError } from '../integrations/anchor/webhook';
import type {
  AnchorTransferEventData,
  AnchorVirtualAccountCreditedData,
} from '../integrations/anchor/types';
import { settlementService } from '../modules/transactions/settlement.service';
import { reversalService } from '../modules/transactions/reversal.service';
import { topupService } from '../modules/transactions/topup.service';
import { transactionsRepo } from '../modules/wallet/transactions.repo';

const HEADER = 'x-anchor-signature';

function eventSubjectId(eventId: string): string {
  const hex = createHash('sha256').update(`anchor-evt:${eventId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const webhooksRoute = new Hono().post('/anchor', async (c) => {
  const secret = env.ANCHOR_WEBHOOK_SECRET ?? process.env.ANCHOR_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: 'webhook_secret_not_configured' }, 503);
  }
  const sig = c.req.header(HEADER) ?? '';
  const raw = await c.req.text();

  let event: ReturnType<typeof parseAndVerifyWebhook>;
  try {
    event = parseAndVerifyWebhook(raw, sig, secret);
  } catch (e) {
    if (e instanceof WebhookSignatureError) {
      logger.warn({ err: e.message }, 'anchor webhook: bad signature');
      return c.json({ error: 'invalid_signature' }, 401);
    }
    logger.warn({ err: (e as Error).message }, 'anchor webhook: parse failed');
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const subjectId = eventSubjectId(event.id);
  const existing = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM audit_log WHERE subject_id = ${subjectId}::uuid
  `);
  if (existing[0]?.count !== '0') {
    return c.json({ status: 'ok', deduped: true }, 200);
  }

  await db.insert(auditLog).values({
    actorKind: 'partner',
    action: `anchor.webhook.${event.type}`,
    subjectKind: 'anchor_webhook',
    subjectId,
    payloadJson: event as unknown as object,
  });

  // Dispatch to handler.
  try {
    if (event.type === 'transfer.completed') {
      const data = event.data as AnchorTransferEventData;
      const txn = await transactionsRepo.findByIdempotencyKey(db, data.reference);
      if (txn) {
        await settlementService.finalise(db, {
          transactionId: txn.id,
          nibssSessionId: data.nibssSessionId ?? null,
          settledAt: new Date(event.createdAt),
        });
      } else {
        logger.warn({ reference: data.reference }, 'transfer.completed: no matching txn');
      }
    } else if (event.type === 'transfer.failed') {
      const data = event.data as AnchorTransferEventData;
      const txn = await transactionsRepo.findByIdempotencyKey(db, data.reference);
      if (txn) {
        await reversalService.reverse(db, {
          transactionId: txn.id,
          reason: data.failureReason ?? null,
          failedAt: new Date(event.createdAt),
        });
      } else {
        logger.warn({ reference: data.reference }, 'transfer.failed: no matching txn');
      }
    } else if (event.type === 'virtual_account.credited') {
      const data = event.data as AnchorVirtualAccountCreditedData;
      await topupService.handle(db, {
        virtualAccountId: data.virtualAccountId,
        amountKobo: kobo(BigInt(data.amountKobo as unknown as string)),
        nibssSessionId: data.nibssSessionId,
        senderBankCode: data.senderBankCode,
        senderAccountNumber: data.senderAccountNumber,
        senderAccountName: data.senderAccountName,
        receivedAt: new Date(event.createdAt),
      });
    } else {
      // kyc.* events: ack only for now (KYC service in Sub-plan 6)
      logger.info({ type: event.type }, 'anchor webhook: ack-only (handler not yet implemented)');
    }
  } catch (e) {
    // We've already audit-logged the event. Handler failure shouldn't 500 to Anchor (they'd retry).
    // Log + ack.
    logger.error({ err: (e as Error).message, type: event.type }, 'anchor webhook handler failed');
  }

  return c.json({ status: 'ok' }, 200);
});
```

- [ ] **Step 2: Verify + commit (tests in T23)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/webhooks.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): /webhooks/anchor dispatches to settlement/reversal/topup by event.type"
```

---

### Task 23: Webhook dispatch tests

**Files:**
- Modify: `apps/backend/tests/routes/webhooks.test.ts`

- [ ] **Step 1: Append dispatch tests to the existing file**

```ts
import { kobo } from '../../src/lib/kobo';
import { txnIntentService } from '../../src/modules/transactions/txn-intent.service';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { postingsRepo } from '../../src/modules/wallet/postings.repo';
import { factories } from '../helpers/factories';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';

async function seedInFlightTxn() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: 'VA-9999', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  // Top up
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  // Reservation
  const txn = await txnIntentService.create(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n), idempotencyKey: 'k-spend-1',
    vendorBankCode: '058', vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M', category: null, agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(5_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(5_000n) },
  ]);
  return { txnId: txn.id, virtualAccount: 'VA-9999', subLA: sw.ledgerAccountId };
}

describe('POST /webhooks/anchor — dispatch', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('transfer.completed → settles the matching txn', async () => {
    const { txnId } = await seedInFlightTxn();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-tc-1', type: 'transfer.completed', createdAt: '2026-05-03T12:00:30Z',
      data: { transferId: 'tr-1', reference: 'k-spend-1', status: 'COMPLETED', nibssSessionId: 'sess-1' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);
    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
  });

  it('transfer.failed → reverses the matching txn', async () => {
    const { txnId, subLA } = await seedInFlightTxn();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-tf-1', type: 'transfer.failed', createdAt: '2026-05-03T12:00:30Z',
      data: { transferId: 'tr-1', reference: 'k-spend-1', status: 'FAILED', failureReason: 'closed' },
    });
    await app.request('/webhooks/anchor', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    const failed = await transactionsRepo.findById(testDb, txnId);
    expect(failed?.status).toBe('failed');
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });

  it('virtual_account.credited → topup booked', async () => {
    const { virtualAccount } = await seedInFlightTxn();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-vc-1', type: 'virtual_account.credited', createdAt: '2026-05-03T12:00:30Z',
      data: {
        virtualAccountId: virtualAccount,
        amountKobo: '50000',
        senderBankCode: '058', senderAccountNumber: '0001112223', senderAccountName: 'SENDER',
        nibssSessionId: 'sess-topup-1',
      },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);
    // Verify a topup transaction exists with the expected idempotency key
    const topup = await transactionsRepo.findByIdempotencyKey(testDb, 'topup:sess-topup-1');
    expect(topup).toBeDefined();
    expect(topup?.amountKobo).toBe(50_000n);
    expect(topup?.status).toBe('settled');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/routes/webhooks.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/webhooks.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): webhook dispatch (transfer.completed / failed / virtual_account.credited)"
```

---

## Phase L — Public HTTP routes (Tasks 24-28)

### Task 24: Actor middleware (placeholder auth)

For MVP, accept `x-actor-user-id` and `x-actor-role` headers as the trust boundary. Real JWT auth lands in Sub-plan 6.

**Files:**
- Create: `apps/backend/src/middleware/actor.ts`
- Create: `apps/backend/tests/middleware/actor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { actor, type Actor } from '../../src/middleware/actor';

describe('actor middleware', () => {
  it('parses x-actor-user-id + x-actor-role into ctx', async () => {
    const app = new Hono().use(actor()).get('/', (c) => {
      const a = c.get('actor') as Actor;
      return c.json({ id: a.userId, role: a.role });
    });
    const res = await app.request('/', {
      headers: { 'x-actor-user-id': 'u1', 'x-actor-role': 'principal' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'u1', role: 'principal' });
  });

  it('returns 401 when headers missing', async () => {
    const app = new Hono().use(actor()).get('/', (c) => c.text('ok'));
    const res = await app.request('/');
    expect(res.status).toBe(401);
  });

  it('returns 401 when role is not principal or agent', async () => {
    const app = new Hono().use(actor()).get('/', (c) => c.text('ok'));
    const res = await app.request('/', {
      headers: { 'x-actor-user-id': 'u1', 'x-actor-role': 'admin' },
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/middleware/actor.ts`**

```ts
import type { MiddlewareHandler } from 'hono';

export type Actor = { userId: string; role: 'principal' | 'agent' };

const ROLES = new Set<Actor['role']>(['principal', 'agent']);

export const actor = (): MiddlewareHandler => async (c, next) => {
  const userId = c.req.header('x-actor-user-id');
  const role = c.req.header('x-actor-role');
  if (!userId || !role) {
    return c.json({ error: 'missing_actor_headers' }, 401);
  }
  if (!ROLES.has(role as Actor['role'])) {
    return c.json({ error: 'invalid_role' }, 401);
  }
  c.set('actor', { userId, role: role as Actor['role'] } satisfies Actor);
  await next();
};
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/middleware/actor.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/middleware/actor.ts apps/backend/tests/middleware/actor.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(middleware): placeholder actor (x-actor-user-id + x-actor-role); real auth in Sub-plan 6"
```

---

### Task 25: Vendors routes

**Files:**
- Create: `apps/backend/src/routes/vendors.ts`
- Modify: `apps/backend/src/server.ts` (mount)
- Create: `apps/backend/tests/routes/vendors.test.ts`

The routes:
- `GET /vendors/name-enquiry?bankCode=&accountNumber=&subWalletId=`
- `GET /vendors/phone-lookup?phoneNumber=&subWalletId=`
- `GET /vendors/sticker/:uuid?subWalletId=`
- `POST /vendors/nqr-decode` (body: `{payload, subWalletId}`)
- `GET /vendors/recents?subWalletId=`

The Anchor adapter is a per-process singleton. Sub-plan 1 / 2 has `anchorConfig` exported but no shared adapter instance. Add one at module load time so routes can use it.

- [ ] **Step 1: Add shared adapter singleton in `apps/backend/src/integrations/anchor/index.ts`**

Append to the existing `index.ts`:

```ts
import { db } from '../../db/client';
import { AnchorClient as _AnchorClient } from './client';
import { AnchorAdapter as _AnchorAdapter } from './adapter';
import { env as _env } from '../../env';

export const anchorAdapterSingleton = new _AnchorAdapter({
  db,
  client: new _AnchorClient({ baseUrl: _env.ANCHOR_API_BASE_URL, apiKey: _env.ANCHOR_API_KEY }),
});
```

(Use underscore-prefixed local re-imports to avoid clashing with the existing `export { AnchorClient, ... }` lines. If your file currently uses different patterns, adjust to match.)

- [ ] **Step 2: Write `apps/backend/src/routes/vendors.ts`**

```ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { actor } from '../middleware/actor';
import { vendorResolutionService } from '../modules/vendors/vendor-resolution.service';
import { recentsService } from '../modules/vendors/recents.service';
import { decodeNqr } from '../modules/vendors/nqr-decoder';
import { isOk } from '../lib/result';

export const vendorsRoute = new Hono()
  .use(actor())
  .get('/name-enquiry', async (c) => {
    const bankCode = c.req.query('bankCode');
    const accountNumber = c.req.query('accountNumber');
    const subWalletId = c.req.query('subWalletId');
    if (!bankCode || !accountNumber || !subWalletId) {
      return c.json({ error: 'missing_params' }, 400);
    }
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'account', bankCode, accountNumber, subWalletId, now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json({ error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400);
  })
  .get('/phone-lookup', async (c) => {
    const phoneNumber = c.req.query('phoneNumber');
    const subWalletId = c.req.query('subWalletId');
    if (!phoneNumber || !subWalletId) return c.json({ error: 'missing_params' }, 400);
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'phone', phoneNumber, subWalletId, now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json({ error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400);
  })
  .get('/sticker/:uuid', async (c) => {
    const uuid = c.req.param('uuid');
    const subWalletId = c.req.query('subWalletId');
    if (!subWalletId) return c.json({ error: 'missing_params' }, 400);
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'sticker', stickerUuid: uuid, subWalletId, now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    const status = result.error.code === 'NOT_FOUND' ? 404 :
      result.error.code === 'STICKER_REVOKED' ? 410 :
      result.error.code === 'STICKER_UNBOUND' ? 409 : 400;
    return c.json({ error: result.error.code }, status);
  })
  .post('/nqr-decode', async (c) => {
    const body = await c.req.json<{ payload: string; subWalletId: string }>();
    if (!body.payload || !body.subWalletId) return c.json({ error: 'missing_params' }, 400);
    const decoded = decodeNqr(body.payload);
    if (!isOk(decoded)) return c.json({ error: 'BAD_INPUT', detail: decoded.error.message }, 400);
    // Confirm via name enquiry path to get authoritative name + touch recents
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'nqr', payload: body.payload, subWalletId: body.subWalletId, now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json({ error: result.error.code }, 400);
  })
  .get('/recents', async (c) => {
    const subWalletId = c.req.query('subWalletId');
    if (!subWalletId) return c.json({ error: 'missing_params' }, 400);
    const list = await recentsService.listTop10(db, subWalletId);
    return c.json({ recents: list }, 200);
  });
```

- [ ] **Step 3: Mount in `apps/backend/src/server.ts`**

Add to the existing `createServer`:

```ts
import { vendorsRoute } from './routes/vendors';
// ... inside createServer:
app.route('/vendors', vendorsRoute);
```

- [ ] **Step 4: Write `apps/backend/tests/routes/vendors.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { stickersRepo } from '../../src/modules/sticker/stickers.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return { agentId: agent.id, subWalletId: sw.sub.id };
}

describe('GET /vendors/sticker/:uuid', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 with ResolvedVendor for an active sticker', async () => {
    const { agentId, subWalletId } = await seedSubWallet();
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058', accountNumber: '0123456789',
      accountName: 'MUSA', vendorPhone: factories.phone(),
      status: 'active',
    });
    const app = createServer();
    const res = await app.request(`/vendors/sticker/${sticker.uuid}?subWalletId=${subWalletId}`, {
      headers: { 'x-actor-user-id': agentId, 'x-actor-role': 'agent' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountName).toBe('MUSA');
    expect(body.source).toBe('sticker');
  });

  it('404 for unknown sticker', async () => {
    const { agentId, subWalletId } = await seedSubWallet();
    const app = createServer();
    const res = await app.request(`/vendors/sticker/${factories.txnId()}?subWalletId=${subWalletId}`, {
      headers: { 'x-actor-user-id': agentId, 'x-actor-role': 'agent' },
    });
    expect(res.status).toBe(404);
  });

  it('401 without actor headers', async () => {
    const { subWalletId } = await seedSubWallet();
    const app = createServer();
    const res = await app.request(`/vendors/sticker/${factories.txnId()}?subWalletId=${subWalletId}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /vendors/recents', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 with empty array when no recents', async () => {
    const { agentId, subWalletId } = await seedSubWallet();
    const app = createServer();
    const res = await app.request(`/vendors/recents?subWalletId=${subWalletId}`, {
      headers: { 'x-actor-user-id': agentId, 'x-actor-role': 'agent' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recents).toEqual([]);
  });
});
```

(NIP name-enquiry / phone-lookup are tested via mocked Anchor calls in the unit tests for the underlying services. The route tests focus on parameter parsing + auth + response shapes. Live Anchor calls are tested in the optional sandbox-smoke.)

- [ ] **Step 5: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/routes/vendors.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/integrations/anchor/index.ts apps/backend/src/routes/vendors.ts apps/backend/src/server.ts apps/backend/tests/routes/vendors.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): GET /vendors/{name-enquiry, phone-lookup, sticker/:uuid, recents} + POST /vendors/nqr-decode"
```

---

### Task 26: Transactions routes

The four endpoints the agent app needs to drive a spend:
- `POST /transactions/intent` — body: `{masterWalletId, subWalletId, amountKobo, idempotencyKey, vendorBankCode, vendorAccountNumber, vendorResolvedName, category, agentNote}` → returns the DRAFT txn
- `POST /transactions/:id/evaluate` — runs lifecycle.evaluate; returns either `{kind:'allow'}` or `{kind:'bump_pending', bumpRequestId}`
- `POST /transactions/:id/send` — calls nip-out.service.send; returns `{anchorTransferId, status}`
- `POST /transactions/:id/resume-after-bump` — body: `{token}` → calls lifecycle.resumeAfterBump

**Files:**
- Create: `apps/backend/src/routes/transactions.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/transactions.test.ts`

- [ ] **Step 1: Write `apps/backend/src/routes/transactions.ts`**

```ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { actor, type Actor } from '../middleware/actor';
import { kobo } from '../lib/kobo';
import { txnIntentService } from '../modules/transactions/txn-intent.service';
import { lifecycleService } from '../modules/transactions/lifecycle.service';
import { nipOutService } from '../modules/transactions/nip-out.service';
import { householdsRepo } from '../modules/identity/households.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';

export const transactionsRoute = new Hono()
  .use(actor())
  .post('/intent', async (c) => {
    type Body = {
      masterWalletId: string;
      subWalletId: string | null;
      amountKobo: string;
      idempotencyKey: string;
      vendorBankCode: string;
      vendorAccountNumber: string;
      vendorResolvedName: string;
      category: string | null;
      agentNote: string | null;
    };
    const body = await c.req.json<Body>();
    const txn = await txnIntentService.create(db, {
      masterWalletId: body.masterWalletId,
      subWalletId: body.subWalletId,
      amountKobo: kobo(BigInt(body.amountKobo)),
      idempotencyKey: body.idempotencyKey,
      vendorBankCode: body.vendorBankCode,
      vendorAccountNumber: body.vendorAccountNumber,
      vendorResolvedName: body.vendorResolvedName,
      category: body.category,
      agentNote: body.agentNote,
    });
    return c.json({ transactionId: txn.id, status: txn.status }, 201);
  })
  .post('/:id/evaluate', async (c) => {
    const id = c.req.param('id');
    const a = c.get('actor') as Actor;
    const result = await lifecycleService.evaluate(db, {
      transactionId: id, initiatingUserId: a.userId, now: new Date(),
    });
    if (result.kind === 'allow') {
      return c.json({ kind: 'allow', status: result.transaction.status }, 200);
    }
    return c.json({
      kind: 'bump_pending', bumpRequestId: result.bumpRequestId,
      status: result.transaction.status,
    }, 202);
  })
  .post('/:id/send', async (c) => {
    const id = c.req.param('id');
    // Look up household ref for narration
    const txn = await db.query?.transactions?.findFirst?.({ where: (t, { eq }) => eq(t.id, id) });
    // Drizzle's relational API may not be enabled; fall back to raw query.
    const { transactions } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const mw = await masterWalletsRepo.findById(db, row.masterWalletId);
    if (!mw) return c.json({ error: 'master_wallet_not_found' }, 404);
    const hh = await householdsRepo.findById(db, mw.householdId);
    const householdRef = hh ? hh.id : row.masterWalletId;

    const result = await nipOutService.send(db, anchorAdapterSingleton, {
      transactionId: id, householdRef, now: new Date(),
    });
    return c.json(result, 202);
  })
  .post('/:id/resume-after-bump', async (c) => {
    const body = await c.req.json<{ token: string }>();
    if (!body.token) return c.json({ error: 'missing_token' }, 400);
    const result = await lifecycleService.resumeAfterBump(db, {
      token: body.token, now: new Date(),
    });
    return c.json({ status: result.transaction.status }, 200);
  });
```

(The `db.query?.transactions?.findFirst?.()` line is a no-op fallback — actual lookup uses the explicit `db.select().from()` below it. Keep both lines as written; the optional-chain fallback documents intent.)

- [ ] **Step 2: Mount in `server.ts`**

```ts
import { transactionsRoute } from './routes/transactions';
// ...
app.route('/transactions', transactionsRoute);
```

- [ ] **Step 3: Write `apps/backend/tests/routes/transactions.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { kobo } from '../../src/lib/kobo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';

async function seedFundedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  return { masterId: mw.master.id, subWalletId: sw.sub.id, agentId: agent.id, principalId: principal.id };
}

describe('POST /transactions/intent + evaluate', () => {
  beforeEach(async () => { await truncateAll(); });

  it('intent creates a DRAFT, evaluate moves to in_flight when no rules block', async () => {
    const { masterId, subWalletId, agentId } = await seedFundedSubWallet();
    const app = createServer();
    const intentRes = await app.request('/transactions/intent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': agentId, 'x-actor-role': 'agent',
      },
      body: JSON.stringify({
        masterWalletId: masterId, subWalletId,
        amountKobo: '5000', idempotencyKey: factories.idempotencyKey(),
        vendorBankCode: '058', vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M', category: null, agentNote: null,
      }),
    });
    expect(intentRes.status).toBe(201);
    const intent = await intentRes.json() as { transactionId: string; status: string };
    expect(intent.status).toBe('draft');

    const evalRes = await app.request(`/transactions/${intent.transactionId}/evaluate`, {
      method: 'POST',
      headers: { 'x-actor-user-id': agentId, 'x-actor-role': 'agent' },
    });
    expect(evalRes.status).toBe(200);
    const evalBody = await evalRes.json() as { kind: string; status: string };
    expect(evalBody.kind).toBe('allow');
    expect(evalBody.status).toBe('in_flight');
  });

  it('rejects intent without actor headers (401)', async () => {
    const { masterId, subWalletId } = await seedFundedSubWallet();
    const app = createServer();
    const res = await app.request('/transactions/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        masterWalletId: masterId, subWalletId,
        amountKobo: '5000', idempotencyKey: factories.idempotencyKey(),
        vendorBankCode: '058', vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M', category: null, agentNote: null,
      }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 4: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/routes/transactions.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/transactions.ts apps/backend/src/server.ts apps/backend/tests/routes/transactions.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): POST /transactions/{intent, :id/evaluate, :id/send, :id/resume-after-bump}"
```

---

### Task 27: Bumps route

Single endpoint: `POST /bumps/:id/decision` — body: `{decision: 'approve_once'|'approve_raise_limit'|'deny'}`.

**Files:**
- Create: `apps/backend/src/routes/bumps.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/bumps.test.ts`

- [ ] **Step 1: Write `apps/backend/src/routes/bumps.ts`**

```ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { actor, type Actor } from '../middleware/actor';
import { bumpWorkflowService } from '../modules/bumps/bump-workflow.service';
import { isOk } from '../lib/result';

export const bumpsRoute = new Hono()
  .use(actor())
  .post('/:id/decision', async (c) => {
    const id = c.req.param('id');
    const a = c.get('actor') as Actor;
    if (a.role !== 'principal') {
      return c.json({ error: 'only_principal_can_decide' }, 403);
    }
    const body = await c.req.json<{ decision: 'approve_once' | 'approve_raise_limit' | 'deny' }>();
    if (!['approve_once', 'approve_raise_limit', 'deny'].includes(body.decision)) {
      return c.json({ error: 'bad_decision' }, 400);
    }
    const result = await bumpWorkflowService.decide(db, {
      bumpRequestId: id,
      decidedByUserId: a.userId,
      decision: body.decision,
      now: new Date(),
    });
    if (isOk(result)) {
      return c.json({
        status: result.value.bumpRequest.status,
        oneShotToken: result.value.oneShotToken?.token ?? null,
      }, 200);
    }
    const status = result.error.code === 'BUMP_NOT_FOUND' ? 404 :
      result.error.code === 'BUMP_EXPIRED' ? 410 :
      409;
    return c.json({ error: result.error.code }, status);
  });
```

- [ ] **Step 2: Mount + tests**

```ts
// server.ts
import { bumpsRoute } from './routes/bumps';
// ...
app.route('/bumps', bumpsRoute);
```

```ts
// apps/backend/tests/routes/bumps.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { kobo } from '../../src/lib/kobo';
import { bumpWorkflowService } from '../../src/modules/bumps/bump-workflow.service';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';

async function seedBump() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    kind: 'spend', amountKobo: kobo(50_000n), idempotencyKey: factories.idempotencyKey(),
  });
  const created = await bumpWorkflowService.create(testDb, {
    transactionId: txn.id, subWalletId: sw.sub.id, requestedByUserId: agent.id,
    amountKobo: kobo(50_000n), vendorResolvedName: 'M',
    now: new Date('2026-05-03T12:00:00Z'),
  });
  return { principalId: principal.id, agentId: agent.id, bumpId: created.bumpRequest.id };
}

describe('POST /bumps/:id/decision', () => {
  beforeEach(async () => { await truncateAll(); });

  it('approve_once → 200 with one-shot token', async () => {
    const { principalId, bumpId } = await seedBump();
    const app = createServer();
    const res = await app.request(`/bumps/${bumpId}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': principalId, 'x-actor-role': 'principal',
      },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; oneShotToken: string | null };
    expect(body.status).toBe('approved_once');
    expect(body.oneShotToken).toMatch(/^[a-f0-9]{48}$/);
  });

  it('403 when actor role is not principal', async () => {
    const { agentId, bumpId } = await seedBump();
    const app = createServer();
    const res = await app.request(`/bumps/${bumpId}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': agentId, 'x-actor-role': 'agent',
      },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(403);
  });

  it('404 for unknown bump', async () => {
    const { principalId } = await seedBump();
    const app = createServer();
    const res = await app.request(`/bumps/${factories.txnId()}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': principalId, 'x-actor-role': 'principal',
      },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/routes/bumps.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/bumps.ts apps/backend/src/server.ts apps/backend/tests/routes/bumps.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): POST /bumps/:id/decision (principal-only, returns one-shot token on approve)"
```

---

### Task 28: End-to-end route smoke

Single test that walks: intent → evaluate (denies + creates bump) → bump decide (approve_once) → resume-after-bump (returns in_flight) → mock-webhook transfer.completed → settled.

**Files:**
- Create: `apps/backend/tests/routes/e2e-spend.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { kobo } from '../../src/lib/kobo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { ruleSetService } from '../../src/modules/rules/rule-set.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';

const SECRET = 'whsec_e2e';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

describe('e2e: intent → evaluate → bump → resume → settle', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('walks the full bump-and-settle path', async () => {
    // Seed
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
    });
    const topup = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, topup.id, [
      { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
      { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
    ]);
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id, createdByUserId: principal.id,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 1_000n } }],
    });

    const app = createServer();
    const idempotencyKey = factories.idempotencyKey();
    const agentHeaders = { 'content-type': 'application/json', 'x-actor-user-id': agent.id, 'x-actor-role': 'agent' };
    const principalHeaders = { 'content-type': 'application/json', 'x-actor-user-id': principal.id, 'x-actor-role': 'principal' };

    // 1. Intent
    const intentRes = await app.request('/transactions/intent', {
      method: 'POST', headers: agentHeaders,
      body: JSON.stringify({
        masterWalletId: mw.master.id, subWalletId: sw.sub.id,
        amountKobo: '10000', idempotencyKey,
        vendorBankCode: '058', vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M', category: null, agentNote: null,
      }),
    });
    const { transactionId } = await intentRes.json() as { transactionId: string };

    // 2. Evaluate (rule denies)
    const evalRes = await app.request(`/transactions/${transactionId}/evaluate`, {
      method: 'POST', headers: agentHeaders,
    });
    expect(evalRes.status).toBe(202);
    const { bumpRequestId } = await evalRes.json() as { bumpRequestId: string };

    // 3. Principal decides approve_once
    const decideRes = await app.request(`/bumps/${bumpRequestId}/decision`, {
      method: 'POST', headers: principalHeaders,
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    const { oneShotToken } = await decideRes.json() as { oneShotToken: string };

    // 4. Resume after bump
    const resumeRes = await app.request(`/transactions/${transactionId}/resume-after-bump`, {
      method: 'POST', headers: agentHeaders,
      body: JSON.stringify({ token: oneShotToken }),
    });
    const resumeBody = await resumeRes.json() as { status: string };
    expect(resumeBody.status).toBe('in_flight');

    // (Skipping POST /:id/send because it would call Anchor; the lifecycle resumed the txn.
    // Manually post a reservation to simulate what nip-out.send would have done.)
    await ledgerService.writeDoubleEntry(testDb, transactionId, [
      { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(10_000n), creditKobo: kobo(0n) },
      { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(10_000n) },
    ]);

    // 5. Mock webhook: transfer.completed
    const webhookBody = JSON.stringify({
      id: 'evt-e2e-1', type: 'transfer.completed', createdAt: '2026-05-03T12:00:30Z',
      data: { transferId: 'tr-e2e-1', reference: idempotencyKey, status: 'COMPLETED', nibssSessionId: 'sess-e2e' },
    });
    const webhookRes = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(webhookBody) },
      body: webhookBody,
    });
    expect(webhookRes.status).toBe(200);

    const finalTxn = await transactionsRepo.findById(testDb, transactionId);
    expect(finalTxn?.status).toBe('settled');
    expect(finalTxn?.nibssSessionId).toBe('sess-e2e');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/routes/e2e-spend.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/e2e-spend.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): e2e spend (intent → evaluate → bump approve → resume → webhook settle)"
```

---

## Phase M — Barrels + final smoke + tag (Tasks 29-32)

### Task 29: Module barrels

**Files:**
- Create: `apps/backend/src/modules/vendors/index.ts`
- Modify: `apps/backend/src/modules/transactions/index.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/vendors/index.ts`**

```ts
export type * from './types';
export { decodeNqr, type DecodedNqr, type NqrError, encodeTlvForTest } from './nqr-decoder';
export { nameEnquiryService } from './name-enquiry.service';
export { phoneLookupService } from './phone-lookup.service';
export { stickerLookupService } from './sticker-lookup.service';
export { recentsRepo, type RecentRow, type UpsertInput } from './recents.repo';
export { recentsService, type TouchInput } from './recents.service';
export {
  vendorResolutionService,
  type ResolveInput,
} from './vendor-resolution.service';
```

- [ ] **Step 2: Replace `apps/backend/src/modules/transactions/index.ts`**

```ts
export {
  lifecycleService,
  type EvaluateInput,
  type EvaluateOutput,
} from './lifecycle.service';

export {
  txnIntentService,
  type CreateIntentInput,
} from './txn-intent.service';

export {
  nipOutService,
  type SendInput,
  type SendOutput,
} from './nip-out.service';

export {
  settlementService,
  NIP_FEE_KOBO,
  type FinaliseInput,
} from './settlement.service';

export {
  reversalService,
  type ReverseInput,
} from './reversal.service';

export {
  topupService,
  type HandleTopupInput,
  type HandleTopupResult,
} from './topup.service';

export {
  reconciliationService,
  type SweepResult,
} from './reconciliation.service';
```

- [ ] **Step 3: Update top-level barrel `apps/backend/src/modules/index.ts`** — add `export * as vendors from './vendors';` (transactions barrel already exists).

- [ ] **Step 4: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules
git -C "C:/Users/alex_/amana" commit -m "feat(modules): vendors barrel + extend transactions + top-level adds vendors"
```

---

### Task 30: README update

Document the new modules + the public route surface.

**Files:**
- Modify: `apps/backend/README.md`

- [ ] **Step 1: Replace** the README with:

```markdown
# @amana/backend

Amana TypeScript backend on Hono.

## Modules

- `modules/identity` — users, households, household members, KYC tier rules.
- `modules/wallet` — master + sub wallets, ledger accounts, transactions, postings, double-entry write helper.
- `modules/audit` — append-only audit log + typed event constructors.
- `modules/sticker` — vendor sticker resolution stub (per Decision #14).
- `modules/rules` — pure-function rule engine + 5 evaluators + replay corpus + versioned rule sets.
- `modules/bumps` — Result-typed state machine + workflow service (create / decide / sweepExpired / consumeToken).
- `modules/anomaly` — 4 features (amount z-score / hour-of-day / vendor novelty / velocity) + weighted aggregator.
- `modules/vendors` — name enquiry / phone lookup / sticker lookup / NQR decoder / recents / unified resolver (per Decision #16).
- `modules/transactions` — lifecycle (rule eval → bump or in_flight) + intent + nip-out + settlement + reversal + topup + reconciliation.
- `integrations/anchor` — BaaS adapter: typed client + circuit breaker + retry + idempotency cache + webhook verifier.

## Public HTTP routes

- `GET  /health` — liveness check (returns version).
- `POST /webhooks/anchor` — Anchor webhook receiver (HMAC-verified, dispatches to settlement / reversal / topup).
- `GET  /vendors/name-enquiry?bankCode&accountNumber&subWalletId`
- `GET  /vendors/phone-lookup?phoneNumber&subWalletId`
- `GET  /vendors/sticker/:uuid?subWalletId`
- `POST /vendors/nqr-decode` — body: `{payload, subWalletId}`
- `GET  /vendors/recents?subWalletId`
- `POST /transactions/intent` — create a DRAFT spend
- `POST /transactions/:id/evaluate` — runs rule engine; returns allow or bump_pending
- `POST /transactions/:id/send` — calls Anchor.transfer (NIP-out)
- `POST /transactions/:id/resume-after-bump` — body: `{token}` (one-shot from bump approval)
- `POST /bumps/:id/decision` — body: `{decision: approve_once | approve_raise_limit | deny}` (principal-only)

All routes (except `/health` and `/webhooks/*`) require `x-actor-user-id` and `x-actor-role` headers as a placeholder for real auth (lands in Sub-plan 6).

## Run locally

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend dev
```

Visit http://localhost:3000/health → `{"status":"ok","version":"0.0.0"}`.

## Test

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend test
```

The test suite includes:
- Property-based tests for the ledger (Σ debits = Σ credits, idempotency replay).
- DB-trigger tests proving postings + audit_log are append-only.
- Mocked unit tests for the Anchor adapter (circuit breaker, retry, idempotency cache).
- Replay-corpus tests for the rule engine.
- End-to-end route test (intent → evaluate → bump → resume → webhook settle).
- An optional live smoke against Anchor's sandbox (skipped unless `ANCHOR_API_KEY` is set).

## Recon runner

```bash
pnpm --filter @amana/backend exec tsx scripts/recon-runner.ts
```

Sweeps any `IN_FLIGHT > 5min` txn and reconciles via Anchor's transfer-status endpoint.
```

- [ ] **Step 2: Commit**

```powershell
git -C "C:/Users/alex_/amana" add apps/backend/README.md
git -C "C:/Users/alex_/amana" commit -m "docs(backend): document new modules + public route surface for Sub-plan 4"
```

---

### Task 31: Full lint + typecheck + test sweep

**Files:** none (verification only).

- [ ] **Step 1: Clean install**

```powershell
docker compose down -v
Get-ChildItem -Path . -Filter node_modules -Recurse -Force -Directory | Remove-Item -Recurse -Force
Remove-Item -Path .turbo -Recurse -Force -ErrorAction SilentlyContinue
pnpm install
```

- [ ] **Step 2: Postgres up + apply ALL migrations**

```powershell
docker compose up -d
Start-Sleep -Seconds 8
pnpm --filter @amana/backend db:migrate
```

- [ ] **Step 3: Build + lint + typecheck + test**

```powershell
pnpm build
pnpm exec biome check .
pnpm typecheck
pnpm --filter @amana/backend test
```

Aim for ≥ 250 tests (Sub-plan 3 finished at 209; Sub-plan 4 adds ~50 more across vendors, txn, routes).

If `biome check` fails on mechanical issues, run `pnpm exec biome check --write .` and commit as `style: ...`. **Do NOT use `--fix --unsafe`** — Sub-plan 2 had a real semantic regression from it.

- [ ] **Step 4: Stop docker**

```powershell
docker compose down
```

---

### Task 32: Push + tag v0.0.4-spend

- [ ] **Step 1: Push + tag**

```powershell
git -C "C:/Users/alex_/amana" push origin main
git -C "C:/Users/alex_/amana" tag -a v0.0.4-spend -m "Sub-plan 4 complete: vendor capture + NIP-out lifecycle + public routes"
git -C "C:/Users/alex_/amana" push origin v0.0.4-spend
```

- [ ] **Step 2: Verify CI green** at https://github.com/Alexander77063/amana/actions.

- [ ] **Step 3: Hand off to Sub-plan 5**

Sub-plan 4 is complete when steps 1–2 are green. The spend pathway works end-to-end: agent captures vendor → creates intent → rule engine evaluates → bump if needed → NIP-out → webhook settles. Sub-plan 5 (notifications + cron-driven reconciliation) builds on this.

---

## Plan complete

When all 32 tasks land green:
- Vendor capture works for all four input shapes (account, phone, sticker, NQR) + recents.
- Transaction lifecycle goes intent → rule eval → bump (if rules deny) → NIP-out → settle/reverse via webhook.
- Reconciliation runner catches stuck txns.
- `/webhooks/anchor` dispatches to settlement / reversal / topup handlers.
- Public HTTP routes are live for both apps (with placeholder auth).
- Tagged `v0.0.4-spend`.

**Next:** Sub-plan 5 — Notifications (FCM / APNs / SMS, principal preference matrix, push receipts, bump push) + cron-driven recon scheduling. Written separately when ready.







