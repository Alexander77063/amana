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
    - **MVP-vs-later split:** TBD (next question).
