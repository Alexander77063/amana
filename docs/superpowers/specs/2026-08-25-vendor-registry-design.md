# Amana — Vendor Registry & the Amana Vendor Code — Design Spec

**Status:** Design approved in brainstorm 2026-08-25 (two forks decided by the user: shadow-mode rollout, threshold-gated inclusion). Awaiting spec review before implementation planning.
**Authors:** Alex Adegbola, with Claude as collaborator.
**Scope:** the vendor identity layer — a passive vendor registry, category resolution, a vendor claim rail, and the Amana Vendor Code. Does not include the implementation plan (next deliverable, produced by `superpowers:writing-plans`).
**Supersedes nothing.** Extends locked decision #14 (vendor capture stack) and #16 (ad-hoc tradesman payments). Does not touch decision #3 — money still moves by NIP, exactly as today.

---

## 1. Overview

### The problem, stated precisely

`apps/backend/src/routes/transactions.ts:26` declares `category: z.string().nullable().default(null)`, and `txnIntentService.create` writes it through to `transactions.category` unchanged. **The category on a spend is supplied by the app doing the spending.** `evaluateCategory` then faithfully enforces a principal's category allowlist against a value the person being restricted just typed.

Category locks are, today, self-attested. Every other control in the rule engine is grounded in something the agent cannot forge — `evaluateLimit` reads the ledger, `evaluateTimeWindow` reads the clock, `evaluateAllowlist` reads NIBSS-resolved account numbers, `evaluateAnomalyThreshold` reads a computed score. Category alone reads the request body.

### What we are building

A **vendor identity layer**: a registry of merchant bank accounts, built passively from settled transactions, that supplies an authoritative category and a stable vendor identity to the rule engine — and, for vendors who claim their entry, an **Amana Vendor Code** they display in-shop.

### Why this shape, and not the obvious one

The obvious version is "onboard vendors, issue them a code." We are explicitly *not* doing that first, because it inverts the cost.

- Locked decision #14 killed capture path D for "recreating the merchant-onboarding problem we explicitly avoided." Zero-vendor-onboarding is the whole point of path B. Making onboarding a *precondition* puts us in a cold-start race we do not need to run.
- Most formal Nigerian vendors already display a bank NQR, and `POST /vendors/nqr-decode` already reads it (`modules/vendors/nqr-decoder.ts` is a working NIBSS TLV parser). Issuing another QR adds **nothing on the payment rail**.
- What issuing a code *does* buy is Amana identity — category, trust state, dispute counterparty. That is worth building. The rail is not.

So onboarding becomes a **byproduct of payments already happening**. Every settled spend teaches the registry who the merchants are. Vendors are then invited to *claim* an entry that already exists, ranked by how much our own users already pay them. That is a distribution flywheel rather than a sales problem.

### One-line framing

> The registry is a measurement instrument first and a control second. It earns the right to deny a transaction only after it has shown, in shadow, that it would have been right to.

### Correcting one thing from the original idea

The original framing was that a scanned code "would reconcile the bank details." Settlement reconciliation already works — NIBSS session id plus `reconciliationService.sweep` on the five-minute cron. A vendor code adds nothing there. What it adds is **attribution**: which merchant, in which category, as which dispute counterparty. This spec is about attribution, not reconciliation.

---

## 2. What already ships (verified against code, 2026-08-25)

Every row below was read in the source, not inferred from docs.

| Capability | Where | State |
|---|---|---|
| NIBSS NQR TLV decode | `modules/vendors/nqr-decoder.ts` | Ships |
| NQR scan endpoint | `routes/vendors.ts` → `POST /vendors/nqr-decode` | Ships |
| Agent NQR camera screen | `apps/agent/src/screens/NQRScanScreen.tsx`, `expo-camera` | Ships |
| Unified vendor resolution | `modules/vendors/vendor-resolution.service.ts` (4 input kinds) | Ships |
| NIBSS name enquiry / phone lookup | `name-enquiry.service.ts`, `phone-lookup.service.ts` | Ships |
| Sticker resolution (uuid → account) | `modules/sticker/sticker-resolver.service.ts`, `vendor_stickers` table | Ships, **unused** |
| Sticker *issuance* | — | **Does not exist.** Nothing outside `stickers.repo.ts` inserts a row |
| Per-sub-wallet recents | `modules/vendors/recents.repo.ts`, `vendor_recents` | Ships |
| Global vendor registry | — | **Does not exist** |
| Category authority | — | **Does not exist.** Category is request-body supplied |

Two findings from that audit shape the design.

**`vendor_recents` cannot be the observation source.** `recentsService.touch` calls `recentsRepo.trimToLimit(db, subWalletId, 10)` on every single write, and `trimToLimit` issues a `DELETE`. The history is destroyed continuously by design — it is a UI convenience list, not a log. The registry needs its own write path.

**`vendor_stickers` was built for exactly this.** Its `status` enum is `['unbound','active','revoked']` and `vendorPhone` is `NOT NULL` — a table shaped for codes pre-issued and claimed later by a vendor who supplies a phone. That is decision #14's own caveat made concrete: "the sticker-resolution endpoint is built in MVP so v1.1 is not a retrofit — only the operational layer waits." This spec builds the operational layer.

---

## 3. Decisions taken in this brainstorm

These are inputs to implementation, not subjects of re-debate. They are **not yet in** `docs/brainstorm/locked-decisions.md` — that file is the canonical registry and should only receive them once this spec is approved. Appending D-V1…D-V8 to it is the first task of implementation planning.

**D-V1 — Vendor identity and marketplace retailer identity stay separate namespaces.**
A vendor never receives a `retailerId`. `evaluateMerchant` is unchanged and remains `retailerId`-only.
*Why:* `merchant.ts` denies when `intent.retailerId` is null, by documented design — "every bank transfer, VAS top-up and direct spend is denied." Unifying the namespaces would make a principal's existing merchant allowlist silently start *permitting* bank transfers it denies today. On an allowlist-only control, a change that quietly widens permission is the wrong direction to be wrong in.

**D-V2 — Issue an Amana code, never a NIBSS NQR.**
*Why:* there is no QR or merchant-provisioning surface anywhere in `integrations/anchor/`, so minting a real NQR is at minimum an open question with Anchor and plausibly requires a licensed acquirer. It is also unnecessary: path B already reads the NQR the vendor has. The code carries Amana identity, which a bank NQR structurally cannot.

**D-V3 — QR before NFC.**
Decision #14A specifies an NFC sticker. We ship QR first.
*Why:* the camera path already works on both platforms (`NQRScanScreen.tsx` + `expo-camera`), whereas this codebase's NFC path is gated to Android (`PairingMethodScreen.tsx:44`) because phone-to-phone pairing needs HCE. To be precise, that gate is about *pairing*; iOS can read a passive NFC tag via Core NFC, so an NFC vendor sticker is not dead on iPhone — it is simply a client capability we would have to build. QR additionally costs nothing to distribute: printable, screenshottable, sendable over WhatsApp, displayable on the vendor's own screen. NFC tags cost ~₦50 each plus a fulfilment operation we would be inventing. NFC stays as the v1.2 premium upgrade for high-traffic shops.

**D-V4 — Category enforcement ships in shadow mode first.** *(user decision)*
The registry category is resolved and logged on every evaluation, but the app-supplied category continues to drive rule outcomes until enforcement is flipped on, per household.
*Why:* switching authority is a retroactive tightening of controls principals wrote under the old semantics. A spend that succeeded yesterday by typing "food" would start requiring a bump. Without shadow data, the first signal is a real denial at a real market stall.

**D-V5 — Registry inclusion is gated by a distinct-household threshold.** *(user decision)*
An account becomes a registry row only once **N distinct households** (default 5) have settled a payment to it.
*Why:* decision #16 makes paying a mechanic or vulcaniser a first-class flow, so the observation stream is thick with private individuals' personal accounts. The threshold *is* the operational definition of "public-facing merchant" — no self-declaration needed — and it is the defensible NDPR line: we promote aggregate commercial facts, never a directory of private individuals.

**D-V6 — Observations are written at settlement, not at resolution.**
*Why:* a resolution is a free lookup. Anyone able to call `GET /vendors/name-enquiry` could otherwise cheaply poison the registry into promoting an account or shifting its category. A *settled* transaction costs real money to fabricate, and it must clear five distinct households. Grounding the threshold in settled money makes registry poisoning economically pointless.

**D-V7 — An observed-consensus category is never enforced in v1.**
Only `category_source IN ('claimed','ops')` is ever authoritative, and only once enforcement is on for that household. Observed consensus is advisory: it populates suggestions and the shadow log.
*Why:* YAGNI, and the shadow data is precisely what will tell us whether observed consensus is trustworthy enough to promote. Deciding now would be deciding without the measurement we are building.

**D-V8 — Consensus is one household, one vote; sensitive categories are claimed-only.**
Category consensus is computed over **distinct households**, never over raw payment counts. Categories on the sensitive list are never derived from observation at all — only a claimed or ops-set category may carry them.
*Why:* see §10.2. Counting payments rather than households lets a single frequent customer set a vendor's category alone, and a rare category is far more disclosive about the people who pay it than a common one. These are the two real weaknesses in a bare threshold rule, and both are cheap to close.

---

## 4. Architecture — one design, three sub-projects

The whole arc is designed here so the data model is coherent, but it ships in three independently valuable increments. **SP-V1 is shippable and useful alone**, with no vendor contact and no mobile change.

| Sub-project | Delivers | Touches | Value standalone |
|---|---|---|---|
| **SP-V1** — Passive registry + shadow | Observation write at settlement, promotion cron, `vendors` table, category resolution, shadow logging | Backend only | Measures how wrong self-attested categories are. Zero user-visible change |
| **SP-V2** — Claim rail + issuance | Vendor claim via SMS/web, ownership proof, code minting, per-household enforcement flip | Backend + a small public web surface | First real category enforcement; the vendor relationship begins |
| **SP-V3** — Code display + scan | `kind: 'vendor'` resolution, agent scan path, `pay.amana.ng/v/<code>` landing page | Backend + both Expo apps + web | The in-shop experience; the growth loop |

### Data flow, end to end

```
   agent pays a market stall
            │
            ▼
   transfer.completed webhook  ──► settlementService.finalise
            │                              │
            │                              └─(best-effort, outside the tx)─►  vendor_observations
            │                                                                  UPSERT (bank, acct, household)
            ▼
   hourly cron: vendor-registry-promote
            │
            ├─ COUNT(households) >= 5  ──► INSERT vendors  (status='observed')
            ├─ recompute category consensus (one household, one vote)
            └─ prune stale sub-threshold observations (>180d)
                        │
                        ▼
   vendor texts to claim  ──► phone-lookup ownership proof ──► vendors.status='claimed'
                                                                category_source='claimed'
                                                                public_code minted
                        │
                        ▼
   agent scans AMNV-7QK2H-9PZ0R  ──► GET /vendors/code/:code ──► ResolvedVendor{vendorId, category}
                        │
                        ▼
   POST /transactions/intent {vendorId}  ──► lifecycleService.evaluate
                                                 │
                                                 ├─ enforcement OFF: app category drives; registry logged
                                                 └─ enforcement ON:  registry category drives
```

---

## 5. Data model

New schema file `apps/backend/src/db/schema/vendors.ts`. Commenting discipline mirrors `marketplace.ts`, which documents *why* each column is nullable and each unique constraint exists — these will be read the same way.

### 5.1 `vendor_observations` — the aggregation source

```ts
export const vendorObservations = pgTable(
  'vendor_observations',
  {
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    // The inclusion unit is the HOUSEHOLD, not the sub-wallet. Putting household_id in the
    // primary key makes COUNT(*) over (bank_code, account_number) the distinct-household count
    // directly — no DISTINCT, no join to wallets at promotion time.
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    // Last NIBSS-authoritative name seen. Not trusted for display; recomputed at promotion.
    accountName: text('account_name').notNull(),
    settledCount: integer('settled_count').notNull().default(1),
    // { "<category>": <count> } as tagged by THIS household's payers. Self-attested and known to
    // be so. Consensus collapses this to a single vote per household (§6.4) — the raw counts must
    // never be summed across households, or one frequent customer outvotes everyone else.
    categoryCounts: jsonb('category_counts').notNull().default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bankCode, t.accountNumber, t.householdId] }),
    // Retention pruning scans by age; promotion scans by account via the PK's leading columns.
    lastSeenIdx: index('vendor_observations_last_seen_idx').on(t.lastSeenAt),
  }),
);
```

This table is **never exposed through any API**. It is a payment graph, and it is the sensitive part of this design.

### 5.2 `vendors` — the registry proper

A row exists only past the threshold.

```ts
export const vendorStatusEnum = pgEnum('vendor_status', ['observed', 'claimed', 'suspended']);
export const vendorCategorySourceEnum = pgEnum('vendor_category_source', ['observed', 'claimed', 'ops']);

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    // NIBSS name at promotion. A claimed vendor may override it with a trading name.
    displayName: text('display_name').notNull(),
    status: vendorStatusEnum('status').notNull().default('observed'),
    // Null until consensus is confident or the vendor claims and picks one.
    category: text('category'),
    // Authority marker. Only 'claimed' and 'ops' are ever enforced (D-V7), and only these two
    // may ever carry a sensitive category (D-V8).
    categorySource: vendorCategorySourceEnum('category_source').notNull().default('observed'),
    // Number of distinct households whose votes produced `category`. Null when category is null.
    // Kept because the confidence of a consensus is not recoverable from the value alone.
    categoryHouseholdCount: integer('category_household_count'),
    // Human-typable code, minted at claim: AMNV-7QK2H-9PZ0R. Null until claimed — an observed
    // vendor has no code to display because nobody has proven they own the account.
    // Unique: the code IS the lookup key for GET /vendors/code/:code.
    publicCode: text('public_code').unique(),
    claimedByPhone: text('claimed_by_phone'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Distinct-household count at the moment of promotion. Kept for audit of the threshold
    // decision; the live count stays in vendor_observations.
    promotedHouseholdCount: integer('promoted_household_count').notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One registry row per bank account. Promotion is an idempotent upsert against this.
    acct: unique('vendors_bank_account_unique').on(t.bankCode, t.accountNumber),
  }),
);
```

### 5.3 Additive columns on existing tables

| Table | Column | Nullable | Purpose |
|---|---|---|---|
| `transactions` | `vendor_id uuid REFERENCES vendors(id)` | yes | Attribution. Null for every pre-existing row and for unregistered vendors |
| `transactions` | `resolved_category text` | yes | The registry's answer, recorded whether or not it was enforced. This is the shadow record |
| `households` | `vendor_category_enforced boolean` | **yes, deliberately** | Three-state: `true` on, `false` off, `NULL` inherit the global default. Lets rollout proceed per household without touching every row |

All three are additive and require no backfill.

### 5.4 What we are *not* changing

`vendor_stickers` keeps its current shape and its current resolver. SP-V2 adds one nullable `vendor_id` FK so a future NFC sticker points at a vendor identity. The two concepts stay honest: **a vendor is an identity; a sticker is a piece of plastic that points at one.** Rewriting `stickerResolverService` is out of scope.

---

## 6. Category resolution and shadow mode

### 6.1 The intent gains two fields

```ts
export type TxnIntent = {
  // ... existing fields unchanged ...
  /** The registry vendor this spend resolved to, if any. Attribution only. */
  vendorId: string | null;
  /** The registry's category answer. Whether it DRIVES evaluation depends on enforcement. */
  resolvedCategory: string | null;
};
```

**No evaluator reads `vendorId`.** This must be stated in the code, because a reviewer will otherwise reasonably assume a new `vendor` rule kind was intended. `evaluateMerchant` remains `retailerId`-only and continues to deny null-retailer intents (D-V1). Adding fields is safe for `anomalyService.score`, which passes the intent to feature functions rather than destructuring it exhaustively.

### 6.2 Enforcement is cheap, which is why shadow mode is cheap

`rules/engine.ts:evaluate(intent, ruleSet, ctx)` is a **pure function** over an already-loaded rule set and an already-computed context. Evaluating twice — once with the app category, once with the registry category — costs one extra in-memory pass and **zero additional database work**. Shadow mode is therefore close to free, which removes the usual argument against it.

In `lifecycleService.evaluate`:

```
enforced = household.vendorCategoryEnforced ?? env.VENDOR_CATEGORY_ENFORCE_DEFAULT

intentLive   = { ...base, category: enforced ? (resolvedCategory ?? txn.category) : txn.category }
decision     = evaluate(intentLive, ruleSet, ctx)          // this is what happens

if (resolvedCategory !== null && resolvedCategory !== txn.category) {
  intentShadow   = { ...base, category: enforced ? txn.category : resolvedCategory }
  decisionShadow = evaluate(intentShadow, ruleSet, ctx)     // the counterfactual
  if (decisionShadow.kind !== decision.kind) {
    audit.append(auditEvents.vendorCategoryShadow({ ... }))
  }
}
```

The shadow branch records the *counterfactual in whichever direction is not live*, so the same instrument keeps working after enforcement is flipped on — it then tells you what enforcement is costing rather than what it would cost.

### 6.3 Env

Following the `RATE_LIMIT_ENABLED` pattern in `env.ts:65`, but defaulting **off** rather than on:

```ts
VENDOR_CATEGORY_ENFORCE_DEFAULT: z.string().optional().transform((v) => v === 'true'),
VENDOR_REGISTRY_MIN_HOUSEHOLDS: z.coerce.number().int().positive().default(5),
// Consensus is measured in HOUSEHOLDS, not payments (D-V8). Deliberately higher than the
// promotion threshold: being listed is a weaker claim than being categorised.
VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS: z.coerce.number().int().positive().default(8),
VENDOR_REGISTRY_CONSENSUS_RATIO: z.coerce.number().positive().max(1).default(0.6),
VENDOR_OBSERVATION_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
// Categories that may never be derived from observation (D-V8, §10.2).
VENDOR_SENSITIVE_CATEGORIES: z.string().default('pharmacy,clinic,health,alcohol,gambling,religious,legal'),
```

### 6.4 Consensus rule — one household, one vote

At promotion and on each subsequent cron pass, for a vendor whose `category_source = 'observed'`:

1. For each observation row (each row *is* one household), take that household's own modal category. That is its **single vote**, regardless of whether it paid the vendor twice or two hundred times.
2. Count votes across households. Require at least `CONSENSUS_MIN_HOUSEHOLDS` households to have voted at all.
3. Set `vendors.category` to the winning vote **only if** it holds ≥ `CONSENSUS_RATIO` of votes. Otherwise `NULL`.
4. **If the winner is on the sensitive list, set `NULL` instead** and leave `category_source = 'observed'`. A sensitive category may only ever arrive by claim or by ops (D-V8).
5. Record `category_household_count`. Never overwrite a vendor whose `category_source` is `claimed` or `ops`.

Step 1 is the whole point and is easy to get wrong: summing `category_counts` across households would let one frequent customer decide a vendor's category by themselves.

**A freshly promoted vendor always has `category = NULL`.** Promotion fires at 5 households and consensus needs 8, so the consensus pass cannot succeed on the run that promotes. This is intended — being listed is a weaker claim than being categorised (§6.3) — but it means the implementer should not wire the consensus call *into* the promotion path and wonder why it never sets anything. Consensus is a separate pass over all `observed` vendors on every cron tick, promotion included but not privileged.

---

## 7. The claim rail (SP-V2)

### 7.1 Ownership proof, using code that already exists

The elegant proof is already in the repo. `phoneLookupService.lookup` resolves a phone number to its **primary BVN-linked bank account** via Anchor. So:

1. Vendor submits phone + bank code + account number.
2. Termii OTP to the phone proves **phone control** (reuse `auth/otp.service.ts`).
3. `phoneLookupService.lookup(phone)` resolving to the *same* `(bankCode, accountNumber)` proves **the phone and the account share a BVN**.

Together those are a solid claim, at zero marginal cost and with no new integration.

**Fallback** for accounts where phone-lookup does not match — typically business accounts not linked to the claimant's BVN-registered phone: a micro-deposit of a random kobo amount to the account, echoed back by the claimant. **Last resort:** ops manual approval behind `ADMIN_API_KEY`, recorded in the audit log with the operator as actor.

### 7.2 The privacy constraint on this endpoint

The claim endpoint **must not reveal whether an account is in the registry.** A generic "if this account qualifies, you'll receive an SMS" response for both the found and not-found cases. Otherwise the endpoint becomes an oracle for "has this account received payments from ≥5 Amana households," which is exactly the aggregate the threshold exists to protect.

The claim surface is rate-limited per-phone and per-IP through the existing `middleware/rate-limit.ts` factory, wired in `attachRateLimiters` alongside the auth routes.

### 7.3 State machine

```
observed ──claim proved──► claimed ──ops/abuse──► suspended
    │                          │                      │
    └──────── ops suspend ─────┴──────────────────────┘

A suspended vendor resolves to 410, mirroring the sticker resolver's REVOKED path.
```

Every guarded transition is an atomic compare-and-set in the repo, never read-then-write — the same discipline `retailerOnboardingService` documents and applies. The preceding read exists only to produce a precise 404/409.

---

## 8. The Amana Vendor Code (SP-V3)

### 8.1 Payload: a URL, not TLV

```
https://pay.amana.ng/v/AMNV-7QK2H-9PZ0R
```

**Why a URL and not an NQR-shaped TLV:**

- Any camera app on any phone opens it. A customer without Amana lands on a page showing the vendor's verified name and account — a real payment can still be made manually, and the page is the top of the growth funnel.
- The Amana apps deep-link straight into the confirm screen.
- No NIBSS licensing question (D-V2).
- The code is **human-typable**, so a vendor can read it aloud over the phone when a camera fails or the print is scuffed. Crockford base32 with the ambiguous glyphs removed — `codes.ts` already establishes this alphabet and its rationale.

### 8.2 Code minting

`mintCode()` in `modules/marketplace/codes.ts` already implements exactly the right thing with an `AMN-` prefix. Rather than duplicate it, extract `randomCrockford` and the alphabet into `lib/crockford.ts` and have both call sites use it — marketplace keeps `AMN-`, vendors get `AMNV-`. This is a targeted improvement to code we are working in, not unrelated refactoring.

Entropy is unchanged at 32^10 ≈ 1.1e15, with the `public_code` UNIQUE constraint as the authoritative dedup and a service-level retry on clash.

**The code is a bearer identifier, and that is fine.** Anyone who photographs a shop's QR can reproduce it. It says only "pay this vendor" — it cannot move money, and the payer still confirms a NIBSS-verified name on screen before sending. What the random code prevents is *enumeration* of the registry.

### 8.3 Resolution

A fifth kind joins `ResolveInput` in `vendor-resolution.service.ts`:

```ts
| { kind: 'vendor'; publicCode: string; subWalletId: string; now: Date }
```

`ResolvedVendor.source` gains `'vendor_code'`, and the type gains `vendorId: string | null` and `category: string | null`. `packages/api-client` and any mirrored type must be updated in step.

**The name is still confirmed by NIBSS name enquiry on every scan**, exactly as the `nqr` branch already does ("the QR may have provided a name but we trust NIBSS"). A stored name goes stale when an account is closed or changed; the confirm screen must show what NIBSS says right now. Caching name enquiry is a deliberate non-goal.

`GET /vendors/code/:code` mirrors the sticker route's status mapping: 404 unknown, 410 suspended, 400 malformed.

---

## 9. Where the money is not touched

Worth stating plainly because the surface area looks large: **this spec changes no money flow.**

- Settlement, reversal, refund, top-up and NIP-out are untouched.
- Double-entry, the `postings` immutability triggers, and `writeDoubleEntry` are untouched.
- No new Anchor integration. `phoneLookupService` and `nameEnquiryService` are existing calls.
- The registry write at settlement is **outside** the settlement transaction and best-effort: a failure logs and is dropped. A missing observation is statistically harmless; a settlement rolled back by a registry bug is not.

The only behavioural change to a spend is which string lands in `intent.category` — and that is gated off by default (D-V4).

---

## 10. Privacy: the disclosure model

The observation table is a payment graph over Nigerian bank accounts. The mitigations are structural, not procedural.

### 10.1 The base protections

1. **Promotion threshold (D-V5).** An account paid by fewer than 5 distinct households never becomes a registry row. The tradesman from decision #16 stays out.
2. **Retention.** The promotion cron deletes observations for sub-threshold accounts with no activity in `VENDOR_OBSERVATION_RETENTION_DAYS` (default 180). Accounts that never look like merchants are forgotten.
3. **No read path.** `vendor_observations` is exposed by no route. Only promoted `vendors` rows are readable, and only their public fields.
4. **No oracle.** The claim endpoint responds identically for known and unknown accounts (§7.2).
5. **Promoted data is already public.** A registry row holds a business name and the bank account it displays on a POS sticker in its own shop window.

### 10.2 Why this is not k-anonymity, and what we borrow anyway

It is tempting to call §10.1's threshold k-anonymity and then reach for l-diversity and t-closeness as the standard hardenings. That reasoning does not survive contact with what we are actually doing, and adopting the names without the mechanism would be cargo-culting.

**Formal k-anonymity governs the release of a table of records**: each record's quasi-identifiers must be indistinguishable from k−1 others, so no individual can be re-identified from a published row. l-diversity then requires each equivalence class to contain l well-represented values of the *sensitive attribute*, defeating the homogeneity attack. t-closeness requires each class's sensitive-attribute distribution to sit within t of the global distribution, defeating skewness and similarity attacks.

We publish no such table. There are no equivalence classes and no per-individual records released. We make a **binary inclusion decision about a business identity**, and the individuals we are protecting — the payers — are never in the released row at all. So neither definition ports, and neither can be satisfied or violated here in its technical sense.

But the *attacks* they were invented against do have analogues, and two of them are real:

**The homogeneity analogue is real, and it bit this spec.** In the first draft, category consensus was computed over raw observation counts. Because `category_counts` accumulates a household's repeated payments, a single frequent customer paying a stall fifty times and tagging it "food" every time would have set that vendor's category alone — a five-household vendor with a one-household category. The fix is the l-diversity instinct applied honestly: **the derived attribute must be supported by l distinct contributors, not l data points.** Hence D-V8 and §6.4 — one household, one vote, with a consensus threshold (8) deliberately higher than the listing threshold (5), because asserting what a business *is* is a stronger claim than asserting that it exists.

**The t-closeness analogue is real, and it is about rare categories.** t-closeness exists because learning that someone falls in a *rare* class of a sensitive attribute discloses far more than learning they fall in a common one. Translated here: `category=food` on a vendor tells an observer almost nothing about the households that pay it, while `category=clinic` or `category=pharmacy` supports a health inference about every one of them. The exposure scales with the rarity and the sensitivity of the category, exactly as t-closeness predicts. So sensitive categories are **never derived from observation** — they may arrive only by claim (the business itself asserting what it is) or by ops. That is D-V8's second half and §6.4 step 4.

**The weakness a bare threshold actually has is neither of those.** It is a *membership-inference oracle on promotion timing*: an attacker who can watch a vendor promote, and who controls some households, learns that a specific number of other households paid that account. The formal tool for that is differential privacy — a randomised threshold, promote at `5 + Laplace(b)` — not l-diversity.

We are deliberately **not** implementing the randomised threshold in v1, for three reasons, and the reasoning is recorded here so a future reader can reverse it on evidence rather than re-derive it:

- **The sybil cost is already high.** Mounting the attack requires creating multiple households, and a household requires a KYC'd principal — real BVN, real NIN, a real Anchor customer (`routes/households.ts` does a live `createCustomer`). Amana's onboarding *is* the sybil defence.
- **Promotion is unobservable to anyone not already paying the vendor.** There is no public "new vendors" feed, promotion runs hourly in batch, and the claim endpoint is a deliberate non-oracle (§7.2). One side channel does exist and is worth naming rather than glossing: once enforcement is on, a principal whose category rule starts behaving differently on a vendor they already pay has observed that vendor's promotion. It is a weak channel — the observer must already be one of the paying households, and what they learn is "at least five, including me" — but it is real, it arrives only with enforcement, and it bounds rather than removes the claim.
- **The payoff is negligible.** The recovered fact is "at least four other households paid this shop" — about a business that, by construction, is public-facing.

If any of those three change — a public directory, a real-time vendor feed, or cheap household creation — the randomised threshold becomes the correct next control, and it is a one-line change at the promotion query. It is listed in §14 as the trigger to revisit.

---

## 11. Error handling

| Failure | Behaviour |
|---|---|
| Observation write fails at settlement | Log at `warn`, drop. Settlement unaffected — the write is outside the transaction |
| Promotion cron fails mid-run | Idempotent; the next hourly pass re-derives from observations. Partial promotion is safe |
| Registry lookup fails during evaluation | `resolvedCategory` is null; evaluation proceeds on the app-supplied category. The registry must never be able to block a spend by being down |
| Unknown / malformed vendor code | 404 / 400 |
| Suspended vendor | 410, mirroring the sticker `REVOKED` mapping |
| Claim on an already-claimed vendor | `ConflictError` → 409 |
| Claim on an unknown account | Generic success-shaped response (§7.2) |
| Anchor down during claim ownership proof | `AnchorHttpError` → 503 `anchor_unavailable`, matching `routes/households.ts` |

---

## 12. Testing

Vitest against real Postgres, per repo convention. `pool: forks`, `singleFork: true`, `truncateAll()` in `beforeEach`.

**The load-bearing test:** with enforcement off, a registry category that *would* deny must produce a byte-identical `Decision` to the one produced without a registry at all — only an audit row differs. If shadow mode can change an outcome, it is not shadow mode.

Others:

- Threshold boundary: 4 distinct households → no `vendors` row; the 5th settlement → promoted. One household paying 20 times → still not promoted.
- **One household, one vote (D-V8):** a household with 50 payments tagged `food` and seven households with one payment each tagged `transport` must yield `transport`, not `food`. This is the homogeneity regression guard and it must exist as a named test.
- **Sensitive categories (D-V8):** an observed consensus of `pharmacy` at any strength leaves `category` null and `category_source = 'observed'`; the same value set by a claim is accepted.
- Consensus thresholds: below `CONSENSUS_MIN_HOUSEHOLDS` → null; a 59% winner → null; a 61% winner → set. A `claimed` category is never overwritten by consensus.
- Poisoning resistance: repeated *resolutions* (no settlement) never create or advance an observation (D-V6).
- Promotion idempotence, as a `fast-check` property: re-running the cron over any observation set is a no-op, and adding observations never demotes a vendor or clears a claimed category.
- Enforcement precedence: `households.vendor_category_enforced` `true`/`false` both override the global default; `NULL` inherits it.
- Privacy: the claim endpoint returns the same response shape and status for a registered and an unregistered account.
- Retention: a sub-threshold observation older than the window is pruned; a promoted vendor's observations are not.
- `evaluateMerchant` is unchanged — an intent with a `vendorId` and a null `retailerId` still denies under a merchant rule (D-V1 regression guard).

Coverage gate (`lines/statements 92, functions 90, branches 80`) must hold; new modules are `src/**` and count.

---

## 13. Out of scope (YAGNI)

- **A vendor-facing app.** Vendors install nothing. Decision #14 stands.
- **A `vendor` rule kind** (allowlist of vendorIds). Not until claimed vendors exist at density; the shadow data will say whether it is wanted.
- **NFC stickers.** v1.2. `vendor_stickers` gains one FK and is otherwise untouched.
- **Minting a real NIBSS NQR.** D-V2.
- **Caching name enquiry.** Every scan re-verifies.
- **Enforcing observed-consensus categories.** D-V7.
- **A differentially-private promotion threshold.** §10.2 — reasoning recorded, trigger conditions named.
- **Vendor payouts, vendor balances, vendor-side anything.** Money moves by NIP exactly as today.
- **Improving `anomaly`'s `vendor_novelty` feature with registry data.** Tempting and cheap later; not now.

---

## 14. Open questions

These are operational, not architectural — none of them block implementation planning.

1. **Claim channel.** SMS shortcode vs WhatsApp Business vs a plain web form. Cost and ops question; the service layer is identical behind any of them.
2. **Threshold values.** 5 households to list, 8 to categorise, 60% agreement. Starting guesses; tune once observation data exists — all three are env vars.
3. **The sensitive-category list.** `VENDOR_SENSITIVE_CATEGORIES` ships with a default that should be reviewed against the real category taxonomy before SP-V1 lands.
4. **Whether observed consensus ever becomes enforceable.** Deliberately deferred to the shadow data (D-V7).
5. **Whether the `pay.amana.ng/v/<code>` landing page ships with SP-V3 or later.** It is the growth loop, but it is also the first public web surface in an app-only product.
6. **Revisit the randomised promotion threshold** if a public vendor directory, a real-time vendor feed, or cheaper household creation ever ships (§10.2).
