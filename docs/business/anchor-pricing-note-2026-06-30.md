# Anchor — Pricing Note (primary source, received 2026-06-30)

> **What this is:** verbatim transcription of Anchor's official pricing note(s), the primary
> source `PRICING.md` is reconciled against. Kept in-repo so the source of record is on hand
> when the model is revisited. Three sheets: BaaS / money-movement, card issuing, bill payment.
> Contact: `busdev@getanchor.co` (BaaS/cards), `hello@getanchor.co` (bills).

---

## 1. Banking-as-a-Service / money movement

### Account

| Service | Amount |
|---|---|
| Deposit Account Creation | ₦0.00 |
| Virtual Account / Sub-Ledger Account Creation | ₦0.00 |
| Monthly Account Maintenance | ₦0.00 |
| Generate Account Statement | ₦0.00 |

Account types: NDIC-insured NUBAN deposit account (consumers & businesses); virtual account
number, static & dynamic (collections); sub-ledger account (wallets).

### Payment / money movement

| Service | Amount |
|---|---|
| Inflow through virtual NUBAN (collections) | 0.5% capped at ₦500 |
| Book transfer (intra-bank) | ₦0.00 |
| Payout (NIP transfer) | ₦50.00 |
| Bulk transfer | cost varies per transfer type |
| Transfer out above ₦10,000,000 (account maintenance) | ₦50 + 0.1% capped at ₦50,000 |

> **N/B (verbatim):** "In compliance with CBN regulation, a stamp duty of ₦50.00 is charged on
> transfers over ₦10,000.00."

Features: interbank transfer (NIP) inbound/outbound; book transfer; bulk transfers/payout.

### Verifications (KYC / KYB)

| Service | Amount |
|---|---|
| Individual KYC Tier 2 | ₦50.00 |
| Individual KYC Tier 3 | ₦200.00 |
| Business KYC | ₦1,000.00 |

---

## 2. Card issuing (virtual USD cards) — *not currently used by Amana*

White-labelled virtual USD cards. Two monthly transaction limits ($5,000 / $10,000) plus a
customisable enterprise tier.

| Service / feature | $5,000 card | $10,000 card |
|---|---|---|
| Transaction fee | 1% ($1 min., cap $10) | 1% ($1 min., cap $10) |
| Card withdrawal fee | $1.00 | $1.00 |
| Card funding fee | 1% ($1 min.) | 1% ($1 min.) |
| Monthly card maintenance (per card) | $1 | $2 |
| Cards per user | Unlimited | Unlimited |
| Daily funding limit (24h) | $2,500 | $5,500 |
| Daily transaction limit (24h) | $2,500 | $5,000 |
| Daily withdrawal limit (extendable w/ approval) | $200 | $200 |
| Card creation fee (one-off per card) | $1 | $2 |
| Issuing-wallet funding fee | USD 0.5% cap $100 · stablecoins 1.5% · NGN ₦1,000 flat | (same) |
| Card decline fee | $0.00 | $0.00 |
| Foreign transaction fee (non-USD) | 1.5% | 1.5% |
| KYC verification | $1.75 | $1.75 |
| Dispute processing fee | higher of $30 or 30% | higher of $30 or 30% |
| **Monthly platform fee** | **$500.00** | **$500.00** |

> The **$500/mo platform fee is a card-product fee only** — it does not apply to the BaaS
> product above unless Amana issues cards.

---

## 3. Bill payment (VAS) — commissions Anchor pays out

### Airtime & data
MTN prepaid recharge VTU **2.0%** · Glo e-pin/VTU **2.0%** · 9mobile VTU/data **2.0%** ·
Airtel VTU/data **2.0%**.

### TV subscription
DSTV / GOTV / Startimes — **1.2% capped at ₦1,500**.

### Electricity (all **capped at ₦1,000**)
1% — Abuja (AEDC), Enugu (EEDC), Kaduna (KAEDC), Port Harcourt (PHED), Jos (JED), Eko (EKEDC),
Kano (KEDCO), Benin (BEDC), BH.
0.5% — Ibadan (IBEDC), Ikeja (IE), Access Power.
