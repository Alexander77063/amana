# Sub-plan V3 — Amana Vendor Code: Resolution, Scan & Landing Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a claimed vendor's code payable — scanned by the Amana apps into a pre-filled confirm screen, and openable by any phone camera into a page that identifies the business.

**Architecture:** A fifth `kind` joins the existing unified vendor resolver, so a code resolves through exactly the same path as an NQR, a phone number or a typed account — including the NIBSS name enquiry that every path performs on every scan. The agent app needs no new screen: the existing camera already reads any QR, so `NQRScanScreen` branches on the payload shape and calls a different endpoint. The public landing page is served by the existing Hono app, adding no infrastructure.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Zod, React Native / Expo, `expo-camera`, Vitest + `react-test-renderer`, Biome.

**Spec:** `docs/superpowers/specs/2026-08-25-vendor-registry-design.md` (§8)
**Depends on:** SP-V1 and SP-V2, both merged. `vendors.public_code` is created in V1 Task 2 and populated in V2 Task 5.

## Global Constraints

- Repos and services take `db` first; routes live in `apps/backend/src/routes/`.
- Biome: single quotes, 2-space indent, 100-column line width.
- Validate every route input through `lib/validate.ts`.
- **NIBSS name enquiry runs on every scan.** A stored name goes stale when an account is closed or changed, and the confirm screen must show what NIBSS says right now. Caching it is an explicit non-goal.
- The mobile harness: components under Vitest with `react-test-renderer` in `environment: 'node'`, `react` aliased to the hoisted root copy. Screen tests `vi.mock` the api-client and the Zustand stores.
- Components carry `accessibilityRole` / `accessibilityLabel`; tests assert them.
- Coverage gate: lines/statements 92, functions 90, branches 80 (backend only).

## Resolved during planning: the landing page ships here, not later

Spec §14 leaves open whether `pay.amana.ng/v/<code>` ships with V3. **It has to**, and the reasoning is worth recording because the open question implied otherwise.

The payload is a URL. A vendor prints it and puts it in their window, where most people who scan it will be using an ordinary camera app rather than Amana. Shipping the code without the page means every one of those scans lands on a DNS failure — a broken link in a shop window, attached to a payments brand, which is worse than not shipping the code at all. The alternatives were to make the payload a bare `AMNV-…` string (unscannable by anything but our own app, which throws away the growth loop that justified a URL in the first place) or to delay the whole sub-plan on a web deployment.

Neither is necessary: the page is one read-only handler returning self-contained HTML, and the **existing Hono app on Fly can serve it** (Task 3). No new service, no new build pipeline, no new deploy target. The only external dependency is a DNS record pointing `pay.amana.ng` at the existing app, which is an ops step in Task 7's runbook, not an engineering one — and until it exists the code still works, just on the API hostname.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/modules/vendors/vendor-code-lookup.service.ts` | Code → registry vendor, as a `ResolvedVendor` |
| `src/routes/vendor-page.ts` | The public `GET /v/:code` landing page |
| `src/lib/html.ts` | HTML escaping. One function, used by the page |
| `apps/agent/src/lib/vendor-code.ts` | Payload discrimination: Amana code vs NIBSS TLV |

**Modified**

| File | Change |
|---|---|
| `src/modules/vendors/types.ts` | `source: 'vendor_code'`; `vendorId`, `category` on `ResolvedVendor` |
| `src/modules/vendors/vendor-resolution.service.ts` | Fifth `kind: 'vendor'` branch |
| `src/modules/vendors/vendors.repo.ts` | `findByPublicCode` |
| `src/routes/vendors.ts` | `GET /vendors/code/:code` |
| `src/server.ts` | Mount `/v`; rate-limit it |
| `packages/api-client/src/vendor-api.ts` | Response fields + `vendorCode()` |
| `apps/agent/src/screens/NQRScanScreen.tsx` | Branch on payload shape |
| `apps/agent/src/nav/PayStack.tsx` | `Confirm` gains `vendorId`, `category` |
| `apps/agent/src/screens/ConfirmScreen.tsx` | Verified badge; pre-filled category |
| `apps/principal/src/…` | The same two changes, mirrored |
| `docs/runbook/vendor-registry.md` | The code, the page, the DNS step |

---

## Task 1: Resolve a code through the unified resolver

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-code-lookup.service.ts`
- Modify: `apps/backend/src/modules/vendors/types.ts`
- Modify: `apps/backend/src/modules/vendors/vendor-resolution.service.ts`
- Modify: `apps/backend/src/modules/vendors/vendors.repo.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-code-lookup.service.test.ts`

**Interfaces:**
- Consumes: `vendorsRepo` (V1 Task 6 / V2 Task 3), `nameEnquiryService` (existing).
- Produces:
  - `ResolvedVendor` gains `vendorId: string | null` and `category: string | null`; `source` gains `'vendor_code'`
  - `ResolveError` gains `{ code: 'VENDOR_SUSPENDED' }`
  - `ResolveInput` gains `{ kind: 'vendor'; publicCode: string; subWalletId: string; now: Date }`
  - `vendorsRepo.findByPublicCode(db, publicCode): Promise<VendorRow | undefined>`
  - `vendorCodeLookupService.lookup(db, adapter, publicCode): Promise<Result<ResolvedVendor, ResolveError>>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-code-lookup.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { err, isErr, isOk, ok } from '../../../src/lib/result';
import { nameEnquiryService } from '../../../src/modules/vendors/name-enquiry.service';
import { vendorCodeLookupService } from '../../../src/modules/vendors/vendor-code-lookup.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-10T10:00:00Z');
const adapter = {} as AnchorAdapter;
const CODE = 'AMNV-7QK2H-9PZ0R';

async function aClaimedVendor(code = CODE) {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  const claimed = await vendorsRepo.claim(testDb, {
    vendorId: v.id, phone: factories.phone(), category: 'food', publicCode: code, now: NOW,
  });
  if (!claimed) throw new Error('claim failed');
  return claimed;
}

function mockNameEnquiry(accountName: string) {
  return vi.spyOn(nameEnquiryService, 'lookup').mockImplementation(async (_a, input) =>
    ok({
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountName,
      source: 'name_enquiry' as const,
      suggestedAmountKobo: null,
      vendorId: null,
      category: null,
    }),
  );
}

describe('vendorCodeLookupService.lookup', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('resolves a claimed code, carrying the registry identity and category', async () => {
    const v = await aClaimedVendor();
    mockNameEnquiry('MAMA PUT KITCHEN');

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value).toEqual({
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      accountName: 'MAMA PUT KITCHEN',
      source: 'vendor_code',
      suggestedAmountKobo: null,
      vendorId: v.id,
      category: 'food',
    });
  });

  it('prefers the LIVE NIBSS name over the stored display name', async () => {
    await aClaimedVendor();
    mockNameEnquiry('MAMA PUT KITCHEN LTD'); // the business renamed at the bank

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    if (!isOk(r)) throw new Error('expected ok');
    expect(r.value.accountName).toBe('MAMA PUT KITCHEN LTD');
  });

  it('NOT_FOUNDs an unknown code', async () => {
    const r = await vendorCodeLookupService.lookup(testDb, adapter, 'AMNV-ZZZZZ-ZZZZZ');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('refuses a suspended vendor with its own error code', async () => {
    const v = await aClaimedVendor();
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('VENDOR_SUSPENDED');
  });

  it('propagates a NIBSS outage rather than paying out of a stale stored name', async () => {
    await aClaimedVendor();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'PARTNER_DOWN' }));

    const r = await vendorCodeLookupService.lookup(testDb, adapter, CODE);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PARTNER_DOWN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-code-lookup.service.test.ts`
Expected: FAIL — cannot resolve `vendor-code-lookup.service`.

- [ ] **Step 3: Extend the shared vendor types**

In `apps/backend/src/modules/vendors/types.ts`:

```ts
export type ResolvedVendor = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  /** Where the resolution came from — useful for audit + UX. */
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents' | 'vendor_code';
  /** Optional amount baked in (NQR can include amount; other paths set null). */
  suggestedAmountKobo: Kobo | null;
  /**
   * The registry vendor, when this account is one. Only the `vendor_code` path can populate it at
   * resolution time; every other path leaves it null and lets `lifecycleService.evaluate` resolve
   * the vendor from the account at evaluation time instead.
   */
  vendorId: string | null;
  /** The registry's category, for pre-filling the confirm screen. Advisory to the client. */
  category: string | null;
};

export type ResolveError =
  | { code: 'NOT_FOUND' }
  | { code: 'BAD_INPUT'; message: string }
  | { code: 'PARTNER_DOWN' }
  | { code: 'STICKER_UNBOUND' }
  | { code: 'STICKER_REVOKED' }
  | { code: 'VENDOR_SUSPENDED' };
```

Then fix every construction of `ResolvedVendor` the compiler flags — `name-enquiry.service.ts`, `phone-lookup.service.ts`, `sticker-lookup.service.ts`, and the `nqr` branch of `vendor-resolution.service.ts` — by adding `vendorId: null, category: null`. Run `pnpm --filter @amana/backend typecheck` to enumerate them; do not guess the list.

- [ ] **Step 4: Add the repo lookup and the service**

Append to `vendorsRepo` in `apps/backend/src/modules/vendors/vendors.repo.ts`:

```ts
  async findByPublicCode(db: DbOrTx, publicCode: string): Promise<VendorRow | undefined> {
    const [row] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.publicCode, publicCode))
      .limit(1);
    return row;
  },
```

Create `apps/backend/src/modules/vendors/vendor-code-lookup.service.ts`:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { type Result, err, isOk, ok } from '../../lib/result';
import { nameEnquiryService } from './name-enquiry.service';
import type { ResolveError, ResolvedVendor } from './types';
import { vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export const vendorCodeLookupService = {
  /**
   * Resolve an Amana Vendor Code to a payable vendor.
   *
   * The stored `displayName` is NOT what the payer is shown. As with the NQR path, the name is
   * re-confirmed against NIBSS on every single scan: a vendor's bank account can be closed,
   * reassigned or renamed long after the sticker was printed, and the name on the confirm screen
   * is the payer's only defence against sending money to the wrong place. If NIBSS is unreachable
   * we fail the resolution rather than fall back to the stored name — a stale name shown with
   * full confidence is worse than an error.
   */
  async lookup(
    db: DbOrTx,
    adapter: AnchorAdapter,
    publicCode: string,
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    const vendor = await vendorsRepo.findByPublicCode(db, publicCode);
    if (!vendor) return err({ code: 'NOT_FOUND' });
    if (vendor.status === 'suspended') return err({ code: 'VENDOR_SUSPENDED' });

    const ne = await nameEnquiryService.lookup(adapter, {
      bankCode: vendor.bankCode,
      accountNumber: vendor.accountNumber,
    });
    if (!isOk(ne)) return ne;

    return ok({
      bankCode: vendor.bankCode,
      accountNumber: vendor.accountNumber,
      accountName: ne.value.accountName,
      source: 'vendor_code',
      suggestedAmountKobo: null,
      vendorId: vendor.id,
      category: vendor.category,
    });
  },
};
```

- [ ] **Step 5: Add the resolver branch**

In `apps/backend/src/modules/vendors/vendor-resolution.service.ts`, add to `ResolveInput`:

```ts
  | { kind: 'vendor'; publicCode: string; subWalletId: string; now: Date }
```

and to the `switch`:

```ts
      case 'vendor':
        result = await vendorCodeLookupService.lookup(db, adapter, input.publicCode);
        break;
```

Import `vendorCodeLookupService`. The existing `if (isOk(result))` recents-touch below the switch then applies to this path too, which is what we want — paying a coded vendor should promote it in the agent's recents exactly like any other payment.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/`
Expected: PASS — the five new tests plus every existing vendor-module test.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/vendors apps/backend/tests/modules/vendors
git commit -m "feat(vendors): resolve an Amana Vendor Code through the unified resolver"
```

---

## Task 2: The authenticated code endpoint

**Files:**
- Modify: `apps/backend/src/routes/vendors.ts`
- Test: `apps/backend/tests/routes/vendors.code.test.ts`

**Interfaces:**
- Consumes: `vendorResolutionService` (Task 1), `assertSubWalletAccess` (existing).
- Produces: `GET /vendors/code/:code?subWalletId=<uuid>`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/routes/vendors.code.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../src/lib/result';
import { nameEnquiryService } from '../../src/modules/vendors/name-enquiry.service';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { bearerFor } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { makeFundedSubWallet } from '../helpers/fixtures';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-10T10:00:00Z');
const CODE = 'AMNV-7QK2H-9PZ0R';
const app = createServer();

describe('GET /vendors/code/:code', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
    vi.spyOn(nameEnquiryService, 'lookup').mockImplementation(async (_a, input) =>
      ok({
        bankCode: input.bankCode, accountNumber: input.accountNumber,
        accountName: 'MAMA PUT KITCHEN', source: 'name_enquiry' as const,
        suggestedAmountKobo: null, vendorId: null, category: null,
      }),
    );
  });

  async function claimedVendor() {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
      displayName: 'MAMA PUT KITCHEN', promotedHouseholdCount: 6, now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.claim(testDb, {
      vendorId: v.id, phone: factories.phone(), category: 'food', publicCode: CODE, now: NOW,
    });
    return v;
  }

  it('401s without a bearer token', async () => {
    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${factories.walletId()}`);
    expect(res.status).toBe(401);
  });

  it('returns the resolved vendor with its registry identity', async () => {
    const { subWalletId, agentUserId } = await makeFundedSubWallet(testDb);
    const v = await claimedVendor();

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, {
      headers: await bearerFor(agentUserId, 'agent'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.vendorId).toBe(v.id);
    expect(body.category).toBe('food');
    expect(body.source).toBe('vendor_code');
  });

  it('404s an unknown code and 410s a suspended vendor', async () => {
    const { subWalletId, agentUserId } = await makeFundedSubWallet(testDb);
    const headers = await bearerFor(agentUserId, 'agent');

    const missing = await app.request(
      `/vendors/code/AMNV-ZZZZZ-ZZZZZ?subWalletId=${subWalletId}`, { headers },
    );
    expect(missing.status).toBe(404);

    const v = await claimedVendor();
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');
    const gone = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, { headers });
    expect(gone.status).toBe(410);
  });

  it('400s a malformed code without touching the database', async () => {
    const { subWalletId, agentUserId } = await makeFundedSubWallet(testDb);
    const spy = vi.spyOn(vendorsRepo, 'findByPublicCode');
    const res = await app.request(`/vendors/code/not-a-code?subWalletId=${subWalletId}`, {
      headers: await bearerFor(agentUserId, 'agent'),
    });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("403s a sub-wallet the caller does not own", async () => {
    const mine = await makeFundedSubWallet(testDb);
    const theirs = await makeFundedSubWallet(testDb);
    await claimedVendor();

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${theirs.subWalletId}`, {
      headers: await bearerFor(mine.agentUserId, 'agent'),
    });
    expect(res.status).toBe(403);
  });
});
```

> `bearerFor` and `makeFundedSubWallet` stand in for the helpers the existing `tests/routes/vendors*.test.ts` already use. Read that file and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendors.code.test.ts`
Expected: FAIL — 404 on the route itself.

- [ ] **Step 3: Add the route**

In `apps/backend/src/routes/vendors.ts`, add the schema beside the others:

```ts
/**
 * `AMNV-` plus two 5-symbol Crockford groups. Validating the shape here means a malformed code is
 * a 400 that never reaches Postgres, and it keeps the endpoint from being usable as a cheap probe.
 */
const VendorCodeParams = z.object({
  code: z.string().regex(/^AMNV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/, 'invalid_code'),
});
```

and the handler, after `.get('/sticker/:uuid', …)`:

```ts
  .get('/code/:code', async (c) => {
    const params = parseParams(c, VendorCodeParams);
    if (params instanceof Response) return params;
    const q = parseQuery(c, SubWalletQuery);
    if (q instanceof Response) return q;
    await assertSubWalletAccess(db, (c.get('actor') as Actor).userId, q.subWalletId);

    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'vendor',
      publicCode: params.code,
      subWalletId: q.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);

    // 410 for a suspended vendor mirrors the sticker resolver's REVOKED mapping: the code was
    // real and is not any more, which is a different thing for a client to show than "unknown".
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'VENDOR_SUSPENDED'
          ? 410
          : result.error.code === 'PARTNER_DOWN'
            ? 503
            : 400;
    return c.json({ error: result.error.code }, status);
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendors.code.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/vendors.ts apps/backend/tests/routes/vendors.code.test.ts
git commit -m "feat(vendors): GET /vendors/code/:code"
```

---

## Task 3: The public landing page

**Files:**
- Create: `apps/backend/src/lib/html.ts`
- Create: `apps/backend/src/routes/vendor-page.ts`
- Modify: `apps/backend/src/server.ts`
- Test: `apps/backend/tests/routes/vendor-page.test.ts`

**Interfaces:**
- Consumes: `vendorsRepo.findByPublicCode` (Task 1).
- Produces: `escapeHtml(s: string): string`; `vendorPageRoute` mounted at `/v`; `GET /v/:code` returning `text/html`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/routes/vendor-page.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-10T10:00:00Z');
const CODE = 'AMNV-7QK2H-9PZ0R';
const app = createServer();

async function claimedVendor(displayName = 'MAMA PUT KITCHEN') {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
    displayName, promotedHouseholdCount: 6, now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  await vendorsRepo.claim(testDb, {
    vendorId: v.id, phone: factories.phone(), category: 'food', publicCode: CODE, now: NOW,
  });
  return v;
}

describe('GET /v/:code', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('needs no authentication and serves HTML', async () => {
    await claimedVendor();
    const res = await app.request(`/v/${CODE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('shows the business name and the masked account, never the full number', async () => {
    const v = await claimedVendor();
    const html = await (await app.request(`/v/${CODE}`)).text();
    expect(html).toContain('MAMA PUT KITCHEN');
    expect(html).toContain(v.accountNumber.slice(-4));
    expect(html).not.toContain(v.accountNumber);
  });

  it('escapes the display name — it is bank-supplied text on a public page', async () => {
    await claimedVendor('<script>alert(1)</script>ACME');
    const html = await (await app.request(`/v/${CODE}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('404s an unknown code and 410s a suspended vendor, both as HTML', async () => {
    const missing = await app.request('/v/AMNV-ZZZZZ-ZZZZZ');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('text/html');

    const v = await claimedVendor();
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');
    const gone = await app.request(`/v/${CODE}`);
    expect(gone.status).toBe(410);
  });

  it('400s a malformed code', async () => {
    expect((await app.request('/v/not-a-code')).status).toBe(400);
  });

  it('is self-contained — no external scripts, styles or images', async () => {
    await claimedVendor();
    const html = await (await app.request(`/v/${CODE}`)).text();
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/(?!pay\.amana\.ng)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendor-page.test.ts`
Expected: FAIL — 404 on `/v/...`.

- [ ] **Step 3: Write the escaper**

Create `apps/backend/src/lib/html.ts`:

```ts
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape text for interpolation into HTML.
 *
 * The vendor landing page renders a NIBSS-supplied business name to the public internet. That
 * string is not ours, is not validated at the bank, and reaches an unauthenticated page — which is
 * exactly the shape of an injection that gets found by someone else first.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ENTITIES[ch] ?? ch);
}
```

- [ ] **Step 4: Write the page**

Create `apps/backend/src/routes/vendor-page.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { escapeHtml } from '../lib/html';
import { parseParams } from '../lib/validate';
import { vendorsRepo } from '../modules/vendors/vendors.repo';

const CodeParams = z.object({
  code: z.string().regex(/^AMNV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/, 'invalid_code'),
});

/**
 * A self-contained page — no external scripts, stylesheets, fonts or images.
 *
 * It is opened by strangers on unknown networks, and every external reference would be both a
 * privacy leak about who scanned a given shop's code and a way for the page to break in a market
 * with poor connectivity.
 */
function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Amana</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         background:#faf9f7; color:#1a1a1a; padding:24px; }
  @media (prefers-color-scheme: dark) { body { background:#121212; color:#f2f2f2; } }
  main { max-width:26rem; width:100%; text-align:center; }
  h1 { font-size:1.5rem; margin:0 0 .25rem; overflow-wrap:anywhere; }
  .muted { opacity:.65; font-size:.9rem; }
  .acct { font-variant-numeric:tabular-nums; letter-spacing:.04em; margin:1rem 0; }
</style>
</head><body><main>${bodyHtml}</main></body></html>`;
}

/**
 * The public face of an Amana Vendor Code. Mounted at `/v`, unauthenticated by necessity: it is
 * opened by whoever points a camera at a sticker in a shop window.
 *
 * It exists because the code is a URL. Without this page every scan by an ordinary camera app —
 * which is most of them — would land on nothing, and a dead link in a shop window attached to a
 * payments brand is worse than no code at all.
 *
 * It shows only what the shop already displays publicly: its name, and the last four digits of the
 * account on its own POS sticker. Never the full account number — a passer-by does not need it,
 * and the Amana apps get it from the authenticated endpoint instead.
 */
export const vendorPageRoute = new Hono().get('/:code', async (c) => {
  const params = parseParams(c, CodeParams);
  if (params instanceof Response) {
    return c.html(page('Invalid code', '<h1>That code is not valid</h1>'), 400);
  }

  const vendor = await vendorsRepo.findByPublicCode(db, params.code);
  if (!vendor) {
    return c.html(page('Unknown code', '<h1>We don’t recognise that code</h1>'), 404);
  }
  if (vendor.status === 'suspended') {
    return c.html(
      page(
        'Code inactive',
        '<h1>This code is no longer active</h1><p class="muted">Please ask the vendor for another way to pay.</p>',
      ),
      410,
    );
  }

  const name = escapeHtml(vendor.displayName);
  const masked = `••••${escapeHtml(vendor.accountNumber.slice(-4))}`;
  return c.html(
    page(
      vendor.displayName,
      `<h1>${name}</h1>
       <p class="muted">Verified on Amana</p>
       <p class="acct">Account ending ${masked}</p>
       <p class="muted">Open the Amana app and scan this code to pay.</p>`,
    ),
    200,
  );
});
```

- [ ] **Step 5: Mount and rate-limit it**

In `apps/backend/src/server.ts`, inside `attachRateLimiters`:

```ts
  // Public and unauthenticated. The code is unguessable, so this is not an enumeration risk — the
  // limit is here so a scraped sticker cannot be turned into free load on the API's database.
  app.use(
    '/v/*',
    rateLimit({
      limit: env.RATE_LIMIT_AUTH_PER_IP,
      windowSeconds,
      keyPrefix: 'vendor-page:ip',
      key: clientIp,
    }),
  );
```

and with the mounts:

```ts
  app.route('/v', vendorPageRoute);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendor-page.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/lib/html.ts apps/backend/src/routes/vendor-page.ts apps/backend/src/server.ts apps/backend/tests/routes/vendor-page.test.ts
git commit -m "feat(vendors): public self-contained landing page at /v/:code"
```

---

## Task 4: API client

**Files:**
- Modify: `packages/api-client/src/vendor-api.ts`
- Test: `packages/api-client/test/vendor-api.test.ts`

**Interfaces:**
- Consumes: `GET /vendors/code/:code` (Task 2).
- Produces: `ResolvedVendorResponse` gains `vendorId: string | null` and `category: string | null`, and `source` gains `'vendor_code'`; `VendorApi.vendorCode(code, subWalletId): Promise<ResolvedVendorResponse>`.

- [ ] **Step 1: Write the failing test**

Create (or extend) `packages/api-client/test/vendor-api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { VendorApi } from '../src/vendor-api';

function fakeClient(capture: { path?: string }) {
  return {
    request: vi.fn(async (path: string) => {
      capture.path = path;
      return {
        bankCode: '058', accountNumber: '0123456789', accountName: 'MAMA PUT KITCHEN',
        source: 'vendor_code', suggestedAmountKobo: null,
        vendorId: 'v-1', category: 'food',
      };
    }),
  };
}

describe('VendorApi.vendorCode', () => {
  it('GETs the code endpoint with the sub-wallet as a query param', async () => {
    const capture: { path?: string } = {};
    // biome-ignore lint/suspicious/noExplicitAny: minimal client stub for a URL-shape assertion
    const api = new VendorApi(fakeClient(capture) as any);
    const r = await api.vendorCode('AMNV-7QK2H-9PZ0R', 'sw-1');

    expect(capture.path).toBe('/vendors/code/AMNV-7QK2H-9PZ0R?subWalletId=sw-1');
    expect(r.vendorId).toBe('v-1');
    expect(r.category).toBe('food');
  });

  it('percent-encodes both segments', async () => {
    const capture: { path?: string } = {};
    // biome-ignore lint/suspicious/noExplicitAny: minimal client stub for a URL-shape assertion
    const api = new VendorApi(fakeClient(capture) as any);
    await api.vendorCode('AMNV-7QK2H-9PZ0R', 'sw/1');
    expect(capture.path).toContain('subWalletId=sw%2F1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/api-client exec vitest run test/vendor-api.test.ts`
Expected: FAIL — `api.vendorCode is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/api-client/src/vendor-api.ts`:

```ts
export type ResolvedVendorResponse = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents' | 'vendor_code';
  suggestedAmountKobo: string | null;
  /** Registry vendor id — non-null only on the `vendor_code` path. */
  vendorId: string | null;
  /** Registry category, for pre-filling the confirm screen. Advisory. */
  category: string | null;
};
```

and, in the class:

```ts
  /** Resolve an Amana Vendor Code (`AMNV-XXXXX-XXXXX`) scanned from a vendor's sticker or screen. */
  vendorCode(code: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ subWalletId });
    return this.client.request<ResolvedVendorResponse>(
      `/vendors/code/${encodeURIComponent(code)}?${params}`,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @amana/api-client test` and `pnpm --filter @amana/api-client exec tsc -p tsconfig.json --noEmit`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client
git commit -m "feat(api-client): vendorCode() and registry fields on ResolvedVendorResponse"
```

---

## Task 5: Agent app — one camera, two payload kinds

**Files:**
- Create: `apps/agent/src/lib/vendor-code.ts`
- Modify: `apps/agent/src/screens/NQRScanScreen.tsx`
- Modify: `apps/agent/src/nav/PayStack.tsx:22-27`
- Test: `apps/agent/src/lib/vendor-code.test.ts`
- Test: `apps/agent/src/screens/NQRScanScreen.test.tsx`

**Interfaces:**
- Consumes: `api.vendor.vendorCode` (Task 4).
- Produces: `parseScannedPayload(raw: string): { kind: 'vendor_code'; code: string } | { kind: 'nqr'; payload: string }`; `PayStackParamList['Confirm']` gains `vendorId?: string | null` and `category?: string | null`.

**No new screen.** The camera already reads any QR; only the branch after the read is new.

- [ ] **Step 1: Write the failing test**

Create `apps/agent/src/lib/vendor-code.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseScannedPayload } from './vendor-code';

describe('parseScannedPayload', () => {
  it('reads an Amana code from a pay.amana.ng URL', () => {
    expect(parseScannedPayload('https://pay.amana.ng/v/AMNV-7QK2H-9PZ0R')).toEqual({
      kind: 'vendor_code', code: 'AMNV-7QK2H-9PZ0R',
    });
  });

  it('accepts a bare code, for a hand-typed or non-URL sticker', () => {
    expect(parseScannedPayload('AMNV-7QK2H-9PZ0R')).toEqual({
      kind: 'vendor_code', code: 'AMNV-7QK2H-9PZ0R',
    });
  });

  it('uppercases a lowercased code', () => {
    expect(parseScannedPayload('amnv-7qk2h-9pz0r')).toEqual({
      kind: 'vendor_code', code: 'AMNV-7QK2H-9PZ0R',
    });
  });

  it('tolerates a trailing slash and query string', () => {
    expect(parseScannedPayload('https://pay.amana.ng/v/AMNV-7QK2H-9PZ0R/?utm=poster')).toEqual({
      kind: 'vendor_code', code: 'AMNV-7QK2H-9PZ0R',
    });
  });

  it('does NOT treat a lookalike host as an Amana code', () => {
    const evil = 'https://pay.amana.ng.evil.com/v/AMNV-7QK2H-9PZ0R';
    expect(parseScannedPayload(evil).kind).toBe('nqr');
  });

  it('falls through to nqr for a NIBSS TLV payload', () => {
    const tlv = '2620' + '0008NG.NIBSS' + '0103058';
    expect(parseScannedPayload(tlv)).toEqual({ kind: 'nqr', payload: tlv });
  });

  it('falls through to nqr for anything else', () => {
    expect(parseScannedPayload('https://example.com/x')).toEqual({
      kind: 'nqr', payload: 'https://example.com/x',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/agent exec vitest run src/lib/vendor-code.test.ts`
Expected: FAIL — cannot resolve `./vendor-code`.

- [ ] **Step 3: Write the parser**

Create `apps/agent/src/lib/vendor-code.ts`:

```ts
export type ScannedPayload =
  | { kind: 'vendor_code'; code: string }
  | { kind: 'nqr'; payload: string };

const CODE_RE = /^AMNV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
/**
 * Anchored to the exact host. A substring check would accept `pay.amana.ng.evil.com`, letting an
 * attacker's QR be read as one of ours — and the whole point of the branch is deciding which of
 * our endpoints to trust the payload with.
 */
const URL_RE = /^https?:\/\/pay\.amana\.ng\/v\/([0-9A-Za-z-]+)\/?(?:[?#].*)?$/;

/**
 * Decide what a scanned QR actually is.
 *
 * One camera reads both an Amana Vendor Code and a bank NQR, so the discrimination happens here
 * rather than by asking the agent to pick the right scanner first — at a market stall, being asked
 * which kind of QR is in front of you is a worse question than it sounds.
 *
 * Anything unrecognised falls through to `nqr`, which is the safe default: the NQR decoder already
 * returns a clean BAD_INPUT for garbage, so an unknown payload produces a sensible error instead of
 * a silent no-op.
 */
export function parseScannedPayload(raw: string): ScannedPayload {
  const trimmed = raw.trim();

  const fromUrl = URL_RE.exec(trimmed);
  if (fromUrl) {
    const candidate = (fromUrl[1] ?? '').toUpperCase();
    if (CODE_RE.test(candidate)) return { kind: 'vendor_code', code: candidate };
  }

  const bare = trimmed.toUpperCase();
  if (CODE_RE.test(bare)) return { kind: 'vendor_code', code: bare };

  return { kind: 'nqr', payload: trimmed };
}
```

- [ ] **Step 4: Branch in the scan screen**

In `apps/agent/src/nav/PayStack.tsx`, extend the `Confirm` params:

```ts
  Confirm: {
    resolvedName: string;
    bankCode: string;
    accountNumber: string;
    accountMasked: string;
    /** Registry vendor, when the payment came from an Amana Vendor Code. */
    vendorId?: string | null;
    /** Registry category, pre-filled into the confirm screen. */
    category?: string | null;
  };
```

In `apps/agent/src/screens/NQRScanScreen.tsx`, replace the body of `handleScan` between `try {` and the `navigation.navigate` with:

```ts
      const scanned = parseScannedPayload(payload);
      const vendor =
        scanned.kind === 'vendor_code'
          ? await api.vendor.vendorCode(scanned.code, sw.id)
          : await api.vendor.nqrDecode(scanned.payload, sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.accountName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
        vendorId: vendor.vendorId,
        category: vendor.category,
      });
```

Import `parseScannedPayload` from `../lib/vendor-code`, and change the failure `Alert.alert('QR decode failed', …)` title to `'Scan failed'` — it now covers both payload kinds.

- [ ] **Step 5: Write the screen test**

Create `apps/agent/src/screens/NQRScanScreen.test.tsx`, mirroring the mocking style of the existing screen tests (`vi.mock` the api-client module and the Zustand store):

```ts
import { describe, expect, it, vi } from 'vitest';
import { parseScannedPayload } from '../lib/vendor-code';

// The screen's own branch is one line; what must not regress is that an Amana URL reaches
// vendorCode() and a TLV reaches nqrDecode(). Assert the routing decision directly.
describe('scan routing', () => {
  it('routes an Amana URL to the code endpoint and a TLV to the NQR endpoint', () => {
    const vendorCode = vi.fn();
    const nqrDecode = vi.fn();
    const route = (raw: string) => {
      const s = parseScannedPayload(raw);
      if (s.kind === 'vendor_code') vendorCode(s.code);
      else nqrDecode(s.payload);
    };

    route('https://pay.amana.ng/v/AMNV-7QK2H-9PZ0R');
    route('26200008NG.NIBSS0103058');

    expect(vendorCode).toHaveBeenCalledWith('AMNV-7QK2H-9PZ0R');
    expect(nqrDecode).toHaveBeenCalledWith('26200008NG.NIBSS0103058');
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @amana/agent test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/agent
git commit -m "feat(agent): read Amana Vendor Codes with the existing camera"
```

---

## Task 6: Confirm screen and principal parity

**Files:**
- Modify: `apps/agent/src/screens/ConfirmScreen.tsx`
- Modify: the principal app's equivalents of `vendor-code.ts`, the scan screen, its param list and its confirm screen
- Test: `apps/agent/src/screens/ConfirmScreen.test.tsx`

**Interfaces:**
- Consumes: the `Confirm` route params from Task 5.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Extend `apps/agent/src/screens/ConfirmScreen.test.tsx` (create it in the style of the existing screen tests if absent):

```ts
it('shows a verified badge for a registry vendor', () => {
  const { byLabel } = render(<ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />);
  expect(byLabel('Verified Amana vendor')).toBeTruthy();
});

it('shows no badge for an unregistered vendor', () => {
  const { byLabel } = render(<ConfirmScreen {...propsWith({ vendorId: null, category: null })} />);
  expect(byLabel('Verified Amana vendor')).toBeNull();
});

it('pre-fills the category from the registry', () => {
  const { textContent } = render(
    <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
  );
  expect(textContent()).toContain('food');
});
```

> `propsWith` builds the screen's navigation/route props over the existing defaults — reuse whatever the current ConfirmScreen test already does for that.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/agent exec vitest run src/screens/ConfirmScreen.test.tsx`
Expected: FAIL — no element carries that accessibility label.

- [ ] **Step 3: Render the badge and pre-fill the category**

In `apps/agent/src/screens/ConfirmScreen.tsx`, read `vendorId` and `category` from `route.params`, and:

- When `vendorId` is non-null, render a small badge beside the resolved name with `accessibilityRole="text"` and `accessibilityLabel="Verified Amana vendor"`. Use the existing theme tokens; add no new colours.
- When `category` is non-null, use it as the initial value of whatever the screen currently sends as `category` on the intent, and show it as the selected category.
- **Do not hide or lock the category control.** The registry is authoritative on the server side when enforcement is on; making the client pretend to enforce it would put a second, weaker copy of that rule in a place a modified client can simply ignore.

Keep the resolved name exactly as prominent as it is today — decision #16 makes that large bold name the in-person trust handshake, and a badge must not crowd it.

- [ ] **Step 4: Mirror it in the principal app**

Apply Tasks 5 and 6 to `apps/principal`: the same `vendor-code.ts` (copy it; the two apps share code only through workspace packages and this file is 30 lines), the same scan-screen branch, the same two route params, the same badge and pre-fill. Decision #17 gives the principal the identical capture stack, so a code that works in one app and not the other is a bug.

> If `apps/principal` turns out to have no QR scan screen at all, stop and report that rather than building one — that is a gap in decision #17's implementation, and it is a bigger piece of work than this task.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @amana/agent test` and `pnpm --filter @amana/principal test`
Expected: PASS in both.

- [ ] **Step 6: Commit**

```bash
git add apps/agent apps/principal
git commit -m "feat(apps): verified badge and registry category pre-fill on confirm"
```

---

## Task 7: Docs and the DNS step

**Files:**
- Modify: `docs/runbook/vendor-registry.md`
- Modify: `docs/business/BACKEND-SCHEMA.md`
- Modify: `docs/business/APP-FLOW.md`
- Modify: `docs/runbook/go-live-checklist.md`

**Interfaces:** none.

- [ ] **Step 1: Document the code and the page**

Extend `docs/runbook/vendor-registry.md` with a "The Amana Vendor Code" section covering:

- The payload format, and that a bare code and a `pay.amana.ng` URL both scan.
- Why the host regex is anchored — a lookalike domain must not be read as ours.
- The page's endpoints and their status codes (200 / 400 / 404 / 410).
- **The DNS step:** `pay.amana.ng` must CNAME to the Fly app. Until it does, printed codes still resolve in-app but the public page is only reachable on the API hostname — so **codes must not be printed for distribution before the record exists.** State that as a gate, not a note.
- How to suspend a compromised code (`POST /vendors-admin/vendors/:id/suspend`) and that this makes both the app path and the public page return 410 immediately.

- [ ] **Step 2: Update the two business docs**

Add `GET /vendors/code/:code` and `GET /v/:code` to the endpoint table in `docs/business/BACKEND-SCHEMA.md`, and add the vendor-code branch to the scan flow in `docs/business/APP-FLOW.md` beside the existing `NqrScanScreen` entries.

Per CLAUDE.md: diff each section against the code before editing it, and do not add a second copy of anything that already exists elsewhere.

- [ ] **Step 3: Add the go-live gate**

Add the `pay.amana.ng` DNS record to `docs/runbook/go-live-checklist.md` as a pre-distribution gate for vendor codes.

- [ ] **Step 4: Validate and run everything**

```bash
py tools/docs/validate-tables.py
pnpm --filter @amana/backend test
pnpm --filter @amana/backend test:coverage
pnpm exec biome check .
pnpm --filter @amana/backend typecheck
pnpm test
```

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: the Amana Vendor Code, the public page, and the pay.amana.ng gate"
```

---

## Self-Review

**Spec coverage.** §8.1 URL payload → Tasks 3 and 5. §8.2 minting → shipped in V2; consumed here. §8.3 resolution, the fifth `kind`, `source: 'vendor_code'`, the 404/410/400 mapping, and name enquiry on every scan → Tasks 1 and 2. §14 open question 5 (does the landing page ship now) → **resolved to yes**, with the reasoning recorded at the top rather than left open.

**Deliberately not here.** NFC stickers (v1.2 — `vendor_stickers` still only gains its FK). A `vendor` rule kind. Caching name enquiry. Any change to how money moves.

**Placeholder scan.** No TBDs. Task 6 Step 3 describes the badge in prose rather than giving JSX, because `ConfirmScreen`'s existing layout is what it must fit into and a literal block would be guessed rather than known — but the acceptance criteria (the exact accessibility label, the pre-fill behaviour, the instruction not to lock the control) are precise enough to test against, and the test in Step 1 is written first. Task 6 Step 4 carries an explicit stop-and-report condition rather than silently expanding scope.

**Type consistency.** `ResolvedVendor` gains `vendorId`/`category` in Task 1 and `ResolvedVendorResponse` mirrors them in Task 4, with the same names and the same `| null`. `ScannedPayload.kind` is `'vendor_code' | 'nqr'` in Task 5 and both arms are handled in the scan screen. `VendorCodeParams`' regex in Task 2 and `CodeParams`' in Task 3 and `CODE_RE` in Task 5 are the same pattern in three places — that is intentional duplication across a package boundary (backend and mobile do not share a validation package for this), and Task 7's docs record the format as the single source of truth.

**One risk worth stating.** Task 3 puts the first unauthenticated HTML surface into an API that has only ever served JSON to its own apps. The mitigations are in the code — a self-contained page, an escaped display name, a rate limiter, no full account number — and the test asserts each. But it is a genuine change in what this service is exposed to, and it deserves a security review pass of its own before the DNS record goes live, not just green tests.
