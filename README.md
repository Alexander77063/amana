# Amana

Phone-to-phone controlled-spend wallet for Nigeria.

A principal funds a master wallet and issues sub-wallets to N agents with real-time limits, category locks, time windows, and remote-or-present authorization. Phone-to-phone is between **principal and agent** — vendors are paid via standard NIP transfer.

**Two segments, one primitive:**
- **Households** — parents and school-going kids, heads-of-household and domestic staff, adult children supporting ageing parents.
- **Small businesses** — restaurant owners and kitchen staff, fleet owners and riders, retail managers, construction supervisors, field sales teams, property managers.

The spend pattern is structurally identical in both: principal funds, delegates within rules, controls + audits in real-time.

## Status

MVP design spec complete (2026-05-03). 18 decisions locked. Phase 0 implementation plan written; ready to execute.

- **Design spec:** `docs/superpowers/specs/2026-05-03-amana-design.md`
- **Locked decisions (18):** `docs/brainstorm/locked-decisions.md`
- **Brand brief:** `docs/brainstorm/brand.md`
- **Implementation plans:** `docs/superpowers/plans/`
- **Architecture decision records:** `docs/adr/`

## Develop

See `docs/runbook/local-dev.md`.

## Workflow

1. Brainstorm → 18 locked decisions ✅
2. Design spec ✅
3. Sub-plan 1 — Phase 0 bootstrap (this plan)
4. Sub-plans 2–8 — backend core, vendor capture, notifications, mobile apps, hardening
