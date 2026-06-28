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
