# 1. Monorepo with pnpm + Turborepo

Date: 2026-05-03
Status: Accepted

## Context

We ship a TypeScript backend and two React Native apps that share types,
validation schemas, and an HTTP client. We need consistent versioning and a
single CI run that catches contract drift.

## Decision

Single repository organised as a pnpm workspace with Turborepo orchestrating
build/test/lint/typecheck across packages.

## Alternatives considered

- **Polyrepo (one repo per app/package).** Rejected — guarantees contract drift
  between mobile and backend, slows hiring (more CI configs to learn), and
  removes the option of atomic refactors that touch both sides.
- **npm + workspaces (no Turbo).** Rejected — Turbo's caching is meaningful at
  our planned ~5 packages and grows with team size.
- **Nx.** Plausible. Rejected for now because Turbo is closer to our team's
  scale (a few people) and is simpler to grok. Re-evaluate at 20+ packages.

## Consequences

Single CI run. Single `pnpm install`. One Biome / TypeScript config family.
Cost: contributors must understand the workspace layout.
