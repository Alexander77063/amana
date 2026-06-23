# Amana App Logos — Design Doc

**Date:** 2026-06-23
**Scope:** Fresh, production-grade launcher logos for `@amana/principal` and `@amana/agent`, designed in Figma, exported, and wired into both apps.

## Direction (user-locked)

- **Motif:** Knot / seal of trust — an interlocking knot expressing *amana* (trust, safekeeping) and the Principal→Agent bond.
- **Tone:** Premium & trustworthy — deep navy + metallic gold, restrained geometry.
- **Relationship:** One unified mark, color-coded — Principal **amber**, Agent **blue**.

## The system — "Amana Seal"

A circular **seal/medallion** (safekeeping) with an **interlocking knot** at its heart (two parties, one agreement).

**Shared brand frame (identical on both apps):**
- Deep navy field, subtle radial depth gradient `#0D1B2A` → `#081320`.
- Fine **gold seal ring** `#C9A227` — the constant "Amana" signature across both apps.
- Full-bleed background so the OS mask (iOS squircle / Android circle) never clips the glyph.

**Knot glyph (role-colored, woven over-and-under — NOT the old khatam star):**
- Principal → amber `#D97706` → `#F4B73F`.
- Agent → blue `#2563EB` → `#3B82F6`.

## Variants to build & compare

| Variant | Glyph | Notes |
|---|---|---|
| **A — Square knot** *(pick)* | Two interlaced rounded bands, 4-fold symmetry, diamond negative center | Ancient two-party-unity symbol; reads small |
| **B — Bound diamonds** | Two interlocking woven diamonds | Heritage nod, sharper |
| **C — Endless loop** | Single continuous strand looping back | Elegant; highest muddiness risk when tiny |

**Judging rule:** render each at 1024px **and** ~48–64px under the iOS/Android mask. The masked-small view picks the winner.

## Export checklist (drop-in ready)

- **iOS `icon.png`** — 1024×1024, **no alpha** (iOS flattens transparency to black).
- **Android `adaptive-icon.png`** — glyph inside center ~66% safe zone (corners masked); transparent bg; field color comes from `app.json` → `adaptiveIcon.backgroundColor`.
- **`splash-icon.png`** — centered mark for splash.
- Update both `app.json`s: replace `#1C1C1E` (splash bg + adaptive bg) and `#222222` (notification color) with the navy `#0D1B2A` so the whole app chrome matches the icon.
- Files land in `apps/principal/assets/` and `apps/agent/assets/`.
