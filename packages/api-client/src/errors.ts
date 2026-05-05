/**
 * Thrown for any non-2xx HTTP response or transport-layer failure.
 * `code` is the parsed `error` field from a JSON body when available,
 * falling back to `'http_<status>'` or `'network_error'`.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly body: unknown;

  constructor(message: string, status: number, code: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  static fromResponse(status: number, body: unknown): ApiError {
    const code =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `http_${status}`;
    return new ApiError(`${code} (${status})`, status, code, body);
  }

  static network(cause: unknown): ApiError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ApiError(`network_error: ${msg}`, 0, 'network_error', { cause: msg });
  }
}
