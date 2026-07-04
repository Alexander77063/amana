/**
 * Thrown by service-layer authorization checks. The global error handler maps
 * it to HTTP 403 (no logging / Sentry noise — these are expected denials).
 */
export class ForbiddenError extends Error {
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Thrown when a request conflicts with current state (e.g. a duplicate send on
 * an already-submitted transaction). The error handler maps it to HTTP 409.
 */
export class ConflictError extends Error {
  constructor(message = 'conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Thrown when a referenced resource does not exist (e.g. a redeem for an unknown
 * voucher code). The error handler maps it to HTTP 404.
 */
export class NotFoundError extends Error {
  constructor(message = 'not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when a money movement would breach an active sub-wallet spend limit
 * (daily / 30-day). Raised under the per-sub-wallet advisory lock at the reserve
 * seam, so the caller's transaction rolls back with nothing written. The error
 * handler maps it to HTTP 409 (a conflict with the wallet's current limit state).
 */
export class LimitExceededError extends Error {
  constructor(message = 'spend limit exceeded') {
    super(message);
    this.name = 'LimitExceededError';
  }
}
