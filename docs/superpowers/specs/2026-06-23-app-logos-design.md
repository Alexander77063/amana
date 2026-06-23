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

## Variants built & compared

| Variant | Glyph | Outcome |
|---|---|---|
| **A — Square knot** | Two interlocking rounded squares (diagonal), woven | Rich at 1024px but muddiest at launcher size |
| **B — Bound diamonds** ✅ **SHIPPED** | Two interlocking woven diamonds, horizontal | Cleanest/most legible at every size incl. 52px micro |
| **C — Bound hexagons** | Two interlocking woven hexagons | Strong alt, coin-seal heritage nod (replaced the original "rings" idea, which wove poorly at oblique crossings) |

**Judging rule applied:** rendered each at 1024px **and** ~52–132px under iOS squircle / Android circle masks. The masked-small view chose the winner → **B (bound diamonds)**.

### Final mark spec (shipped)
- Seal: single metallic gold ring (`#E8CB5A`→`#A8841E` vertical), `d≈648` on the full icon.
- Field: navy depth gradient `#14273B`→`#091420` (top→bottom).
- Knot: woven diamonds, metallic accent — Principal `#F7B73F`→`#C26605`, Agent `#5B8DEF`→`#163EB0`.
- Interlace built with the straight-edge "gap weave": under-strand full, over-strand drawn with a single gap at one crossing (Figma `vectorPaths` supports only `M/L/C/Q/Z` — no SVG arcs).

## Export checklist (shipped ✅)

- **iOS `icon.png`** — 1024×1024, **alpha stripped** (RGB, flattened onto navy via sharp) so the App Store accepts it.
- **Android `adaptive-icon.png`** — 1024×1024 navy-gradient field + seal/knot scaled to **0.92** (seal ≈58% of frame, well inside the 66% safe zone). Opaque foreground fully covers the mask; `adaptiveIcon.backgroundColor` set to navy as a fallback.
- **`splash-icon.png`** — same navy-gradient mark, `resizeMode: contain` over the navy splash background → seamless.
- `app.json` (both apps): `#1C1C1E` (splash bg + adaptive bg) → **`#0D1B2A`** navy; `#222222` notification tint → **per-app accent** (Principal `#D97706`, Agent `#2563EB`) — more befitting/visible than navy for an Android small-icon tint.
- Files in `apps/principal/assets/` and `apps/agent/assets/`.

## Source of truth
Figma file **"Amana — App Icons"** (`SI9ztlFIiI20kYqWrN3n09`) holds all three explorations, the masked-size comparison board, and the final `FINAL/Principal-icon`, `FINAL/Principal-glyph`, `FINAL/Agent-icon`, `FINAL/Agent-glyph` frames for re-export.
