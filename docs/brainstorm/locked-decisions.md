# Amana — Locked Decisions

Captured at the end of the brainstorm session preceding the MVP design summary.
Last updated: 2026-05-03.

## Concept (one-liner)

Controlled-spend wallet where a principal (parent or employer) funds a master wallet and issues sub-wallets to dependents (kids or domestic staff) with real-time limits, category locks, and remote-or-present authorization. **Phone-to-phone is between principal and agent** (not agent and merchant). Vendors are paid via standard NIP transfer.

## Foundational principle

**Phone-to-phone is the main thing.** It is the differentiating mechanic and must remain visible in the architecture, the UX, and the brand. Card-centric or merchant-centric framings are explicitly rejected.

## The 13 locked decisions

1. **Licensing path** — Hybrid. Start on a BaaS partner; transition to own CBN license once volume justifies.
2. **Wedge** — Household domestic-staff + family allowance, unified as a single primitive (principal funds, dependent spends within rules, principal controls).
3. **Spend rail** — NIP transfer at MVP. Vendor receives a normal NIP credit; never installs the app. Capture stack defined separately in decision #14. Card deferred to v1.5.
4. **Authorization model** — Pre-authorized rules. Agent spends autonomously within rules. Principal gets configurable visibility (real-time receipts / daily digest / threshold alerts / anomaly alerts) and instant suspend control.
5. **Exception flow** — In-app *"request bump"* for over-limit / out-of-rule spends — the only surviving form of the original "double-handshake" magic, used for exceptions.
6. **Onboarding** — Hybrid: NFC tap-to-pair as the Android marquee (marketing centerpiece) + QR pairing (cross-platform, includes iPhone) + SMS deep-link for remote onboarding (kid at uni).
7. **Wallet structure** — Model 2: **delegated authority**. Single master wallet held by the principal; sub-wallets are ledger entries within it, not separate KYC'd wallets. Funds never legally leave the principal. Agent has spending authority, not ownership. Works for under-18 dependents (no BVN required from kid).
8. **KYC** — Principal = Tier 2 (Phone + BVN + NIN, ₦300K cap; upgrade to Tier 3 if balance > ₦300K). Agent = Phone + NIN only (no own balance; NIN captures identity for AML attribution and receipts).
9. **Funding (master wallet inbound)** — A only at MVP: NIP-in via dedicated virtual account number issued by BaaS partner. (B) card top-up at v1.5. (C-IN) cash-in via agent network at v2 only if deliberately expanding to unbanked-principal wedge. **Salary disbursement is out of scope** — it's a different product (payroll/disbursement), already solved by existing bank apps; we don't bolt it on.
10. **Pricing** — Hybrid C:
    - Free tier: 1 agent, ₦20K monthly throughput
    - Family: ₦1,500/mo, 3 agents
    - Household: ₦4,000/mo, 10 agents
    - Business: ₦10,000/mo, 50 agents
    - Plus ₦25 per outbound NIP
    - Low adoption pricing chosen deliberately; revisit at measurable adoption.
11. **BaaS partner** — **Anchor** as primary (full-stack, builder-focused, modern API, supports delegated multi-user wallets). Architecture wraps BaaS in a **vendor-agnostic adapter layer** (Hexagonal / Ports-and-Adapters) so it's swappable. Bloc as future redundancy. Sudo for card issuance in v1.5.
12. **Brand** — see `brand.md`.
13. **Moat thesis** — Segment ownership (household-and-family fintech) + brand depth in-segment + product depth competitors can't clone in 6 months (rule engine sophistication, exception flow, anomaly detection, multi-principal) + distribution depth (schools, property managers, employer HR, community trust networks) + operational reliability. **Not moats:** better tech, lower price, nicer UX. Strategic posture: deepen brand and segment ownership before incumbents notice us.

14. **Vendor capture stack** — Layered, lowest-friction-first. Money still moves via NIP in all cases (decision #3). Vendor never installs the Amana app.
    - **A. Amana Receive sticker (NFC tap)** — vendor signs up via USSD/SMS (bank account + phone), we mail a free branded NFC sticker. Sticker holds an Amana vendor ID that resolves to the vendor's bank account on our backend. Agent taps phone to sticker → autofill. Marquee experience; doubles as a distribution flywheel ("Pay with Amana" tags in shop windows). Sticker cost ~₦50 at scale.
    - **B. NQR / bank QR scan** — works with any existing NIBSS NQR or bank/POS QR sticker (Moniepoint, Opay, Palmpay, GTBank, etc.). Zero vendor onboarding. Covers most formal vendors today.
    - **C. Smart recents + one-time typed account** — universal fallback; first time type with NIBSS name-enquiry confirmation, every subsequent payment is one tap from the recents list.
    - **Skipped — D. Sound chirp / Bluetooth proximity** — recreates the merchant-onboarding problem we explicitly avoided; no clear advantage over A or B.
    - **MVP-vs-later split:** **MVP = B + C only.** A (Amana Receive stickers) ships in v1.1 once the principal/agent side is proven and we have consumer traction to attract vendors. **Caveat:** the sticker-resolution backend endpoint (vendor-sticker UUID → bank account lookup) is built in MVP so v1.1 is not a retrofit — only the operational layer (vendor sign-up rail, fulfilment, distribution) waits.

15. **Agent attribution / NIP narration** — Outbound NIP narration carries a **hashed agent reference** (e.g. `AMN/AGT/abc12`) plus the principal's wallet reference. The agent's full NIN is held in our audit log only. **Why:** keeps CBN/NFIU AML obligations satisfied (we can resolve any narration to a NIN on request) without leaking domestic staff's NIN into the principal's bank-statement narration. **How to apply:** narration formatter lives in the BaaS Adapter; the audit log entry for every txn includes the un-hashed agent NIN linked to the same hashed reference.

16. **Ad-hoc tradesman / one-off payments** — A first-class supported pattern, not a side case. Mechanics, vulcanisers, electricians, plumbers, market traders, roadside repairs etc. are everyday Nigerian spends — often initiated by the agent on the principal's behalf. The architecture handles them (they're just NIP transfers); the spec adds explicit affordances:
    - **Phone-number-to-account resolution** as part of capture path C — many tradesmen quote phone numbers, not 10-digit account numbers. NIBSS phone-lookup (via Anchor) resolves to primary BVN-linked bank account in <1s.
    - **Large in-person verification UX** — resolved account name shown in big, bold text on the confirm screen. The agent reads it aloud; the tradesman confirms. That moment IS the trust handshake when there's no prior relationship.
    - **"Ad-hoc service" suggested category** — pre-defined category surfaced when the vendor isn't in recents. Principals can write rules around it (e.g. "max ₦10k per ad-hoc service txn, max 3/day").
    - **Optional photo + note + geolocation capture** at confirm time — agent attaches evidence (photo of work, short note, GPS). Lives in the audit log alongside the txn. Useful for principal trust, dispute support, and (for SMBs) ops accountability.
    - **"Show the recipient" post-payment screen** — agent can show tradesman a confirmation screen with the NIBSS session ID and "Should arrive within 30 seconds." Closes the trust loop in person without needing the recipient to install anything.
    - **Why:** ad-hoc tradesman spend is a major real-world Nigerian pattern, especially for delegated spend. Without these affordances, agents will either route around Amana for these spends (defeats the purpose) or rely on bump-bypass loopholes (defeats the controls). All MVP scope.

17. **Principal direct payments** — The principal can make payments directly from the master wallet through the Principal App, using the same vendor capture stack as agents (NQR scan, phone lookup, typed account, recents) and the same ad-hoc tradesman affordances (#16). Architectural treatment:
    - **No sub-wallet involved.** Direct master-wallet spend → `transactions.sub_wallet_id IS NULL`. The schema is already prepared (the column is already nullable); no migration required.
    - **Rule engine skipped (degenerate ALLOW).** Principal has full authority over their own funds; no rule evaluation, no bump flow.
    - **Anomaly scoring still applies.** Useful for fraud detection on a compromised principal account; flags an alert but does not auto-block.
    - **Narration uses simpler form.** Outbound NIP narration is `AMN/[household ref]` — no hashed-actor segment needed since the principal is fully KYC'd at Tier 2/3 and is the legal owner of the funds.
    - **Audit log captures principal as actor.**
    - **Why:** principal is the largest spender in most households (rent, utilities, school fees, large purchases) and in many SMBs (supplier payments, payroll, larger one-offs). Forcing them through a "self sub-wallet" is awkward UX and adds no value.
    - **How to apply:** principal app gets the same vendor-capture screens as the agent app, with a simpler confirm flow (no rule decision shown, no bump path). Backend short-circuits rule_eval and bump for principal-originated txns. Narration formatter selects the principal-form template when `sub_wallet_id IS NULL`.
    - **Out of scope at MVP (worth flagging for future):** principal "self-rules" (e.g., self-imposed daily spending caps, second-factor for large txns, time-window self-locks) — possible v1.x feature, not MVP.

18. **Tech stack** — Locked at the planning stage to unblock implementation plans.
    - **Backend:** TypeScript on Node.js 20+ with Hono framework, Drizzle ORM, postgres-js driver, Zod for validation, Pino for structured logging, Sentry for error tracking, Vitest for tests.
    - **Database:** Postgres 16 with PostGIS extension (for the `geolocation` column on transactions per Decision #16).
    - **Mobile:** React Native via Expo (managed workflow + EAS Build) — one team, one codebase, two apps (Principal and Agent). TypeScript shared with backend via workspace packages.
    - **Monorepo:** pnpm 9+ workspaces with Turborepo for task orchestration. Shared packages: `@amana/types`, `@amana/validation`, `@amana/api-client`.
    - **Quality:** Biome for lint + format. TypeScript strict mode everywhere.
    - **Secrets:** SOPS + age for encrypted secrets in-repo.
    - **CI:** GitHub Actions with pnpm + Turborepo caching.
    - **Hosting (initial):** AWS af-south (Cape Town — closest AWS region to Lagos), ECS Fargate for backend, Aurora Postgres. Parallel CBN data-residency legal review track to confirm before public launch; reversible to a Nigerian DC provider (Layer3, MainOne) if legal requires.
    - **Why these picks:** TS + RN gives one type system, one team, one hiring pool — critical at our scale. Hono is fast, modern, and trivial to test. Drizzle + Postgres gives us proper transactions and migrations. Expo accelerates mobile iteration without locking us out of native modules later (we can eject if needed). AWS af-south is the lowest-latency major-cloud option to NG today.
    - **ADRs to be written in Sub-plan 1:** `docs/adr/0001` through `0005` will document each choice with the considered alternatives, so future re-evaluation has a paper trail.
