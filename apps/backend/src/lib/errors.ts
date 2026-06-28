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
