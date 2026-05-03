// Anchor BaaS adapter surface.
// The real implementation (circuit breaker, idempotency, retries, narration
// formatter, NIBSS name enquiry, NIP-out, phone lookup, webhook verification)
// lands in Sub-plan 2. This file only exists so import paths are stable.

export { anchorConfig, type AnchorConfig } from './sandbox';
