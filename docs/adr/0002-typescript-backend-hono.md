# 2. TypeScript backend on Hono

Date: 2026-05-03
Status: Accepted

## Context

The backend serves the principal and agent apps over HTTPS, integrates with
Anchor (BaaS), runs background recon and notification jobs, and houses the
ledger / rule engine / bump / anomaly modules.

## Decision

TypeScript on Node.js 20+ with Hono as the HTTP framework.

## Alternatives considered

- **Go.** Better raw performance and concurrency, but smaller dev pool in
  Lagos and forces a second type system away from React Native. Re-evaluate if
  per-request latency becomes a bottleneck (current SLO p95 < 500 ms is
  comfortably reachable on Node).
- **Elixir / Phoenix.** Best fit for the bump workflow's stateful nature
  (OTP processes), but the Lagos hiring pool is too small.
- **Express / Fastify.** Both work. Hono picked for: smaller surface area,
  better TypeScript inference, edge-runtime portability if we ever want it,
  and trivial in-process testing via `app.request()`.

## Consequences

One language across backend and mobile. Strong typing end-to-end via shared
workspace packages. Cost: must enforce strict mode and keep build outputs
small (Hono helps).
