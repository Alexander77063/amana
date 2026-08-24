# Buyer marketplace & the control fusion (SP5b)

## The bug this shipped alongside

Before SP5b, `purchase.service` enforced the sub-wallet **spend limit** (SP5a, under
`pg_advisory_xact_lock`) and **nothing else**. It never called the rule engine. So a parent could
lock a sub-wallet to `transport, school` and their agent could buy a voucher for anything in the
catalogue, while the identical spend as a bank transfer was correctly held for approval.

`tools/demo/probe-marketplace.mjs` reproduces it against a running stack and now asserts the fix:

```
parent locked spending to: transport, school
bank transfer tagged health  -> bump_pending
marketplace purchase         -> 409 rule_denied / CATEGORY_NOT_ALLOWED
```

Identical in shape to the VAS hole `probe-vas.mjs` found. If either regresses, one command shows it.

### Which rules apply to a purchase, and which deliberately do not

`assertMarketplaceRulesAllow` evaluates **`category`, `time_window` and `merchant`** and filters
`limit` out. The limit is already enforced inside the advisory lock in `reserve`; evaluating it a
second time *outside* that lock would reintroduce the evaluate-then-reserve race the lock exists
to close.

### Why an out-of-rule purchase rejects instead of asking for a bump

Spec §8 says an agent going over should hit the existing request-bump flow. That is not reachable
from here: `bump_pending` is produced by `lifecycle.service.evaluate`, the purchase path does not
go through it, and `resumeAfterBump` has no route back into `createFromCatalog`. A "pending"
voucher would be one nothing could ever release. So it rejects — consistent with SP5a's deliberate
reject-not-bump for over-limit.

**Deferred, not forgotten:** making these bumpable means wiring `marketplace_purchase` into the
bump workflow and giving resume a path back into the catalogue purchase.

## `category` vs `section` on a catalogue item

Two fields, and conflating them is a live footgun:

| Field | Who sets it | What it is for |
|---|---|---|
| `section` | the retailer, free text | merchandising — "hair", "nails", "grocery" |
| `category` | the retailer, from the closed `SPEND_CATEGORIES` list | what a **parent's category lock** is matched against |

A parent's lock is written in the closed vocabulary. Matching it against retailer-typed free text
is exactly the drift `packages/types/src/categories.ts` warns about — a lock would deny legitimate
items or permit ones it meant to block depending on what someone happened to write. Items created
before migration `0033` default to `other`, which an allowlist **denies**: the safe direction for
a column added underneath a live lock.

## The control fusion: approving a merchant writes a rule

The marketplace and the rule engine are one system. Approving a shop does not tick a
marketplace-only box — it edits the sub-wallet's rule set, and the same engine that enforces the
daily limit enforces this.

`merchant-approval.service` reads the active rule set, **merges** the merchant rule into it, and
republishes the whole thing. That is the dangerous part: `publishNewVersion` supersedes the active
set and takes the entire rule array, so publishing only the merchant rule would silently delete
the parent's limit and category lock — turning "I approved one shop" into "I removed every
restriction I set". A test asserts the other three rules survive an approval.

### Three states, and they are not two

| State | Meaning | Effect |
|---|---|---|
| no `merchant` rule | the parent has never used merchant approval | marketplace unrestricted |
| `retailerIds: [...]` | these shops approved | only these |
| `retailerIds: []` | every approval revoked | **nothing** may be bought |

An empty list denying everything is deliberate. Dropping the rule when the last shop is revoked
would re-open the whole catalogue at the moment the parent thought they were closing it.

The rule is **allowlist-only**. A blocklist would mean "every retailer except these", silently
granting access to businesses onboarded tomorrow that the parent has never seen.

An intent with **no retailer** — every bank transfer, VAS top-up and direct spend — is denied by a
merchant rule, which is why one is only ever evaluated on the marketplace path. `lifecycle` and
`vas` pass `retailerId: null` explicitly.

## Browse

`GET /marketplace/sections` and `GET /marketplace/items?section=` are filtered from the **same
active rule set the purchase path enforces**, so browse cannot show what buying would refuse for a
reason browse could have known (§8: "agents only ever see what they're already allowed to buy").

Only `category` and `merchant` filter the display. A limit or time window can refuse now and allow
in an hour; hiding items for those would make the catalogue flicker and conceal things the agent
may legitimately buy.

An agent's scope is always their **own** sub-wallet — a supplied id is ignored, not honoured, or
the catalogue becomes a way to read another household's approvals. A principal may preview a
sub-wallet they own, checked by the same ownership assertion the purchase path uses.

Prices come from `effectivePriceKobo`. Rendering `priceKobo` would quote a buyer a number they
will not be charged.

## Running it locally

```bash
# stack
docker compose up -d
pnpm --filter @amana/backend db:migrate
STUB_PORT=3200 node tools/anchor-stub/server.mjs
NODE_ENV=development PORT=3100 DEV_OTP_BYPASS_CODE=123456 \
  ANCHOR_API_BASE_URL=http://localhost:3200 ANCHOR_API_KEY=stub-key \
  ADMIN_API_KEY=demo-admin-key-000000000000000000 \
  pnpm --filter @amana/backend dev

# prove the rule gate still holds
BACKEND_URL=http://localhost:3100 node tools/demo/probe-marketplace.mjs
```

## Still deferred

- **Bumping an out-of-rule purchase** (above) — the one place this diverges from spec §8.
- **Funded-campaign deals.** `deal_type` has only `markdown`.
- **Sponsored placement.** §8 requires any such placement be labelled and never the worst-priced
  option; none exists yet, so neither does the labelling.
- **USSD purchase** for feature-phone buyers.
