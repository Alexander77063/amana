import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';

describe('ApiError', () => {
  it('fromResponse extracts code from {error} body', () => {
    const e = ApiError.fromResponse(401, { error: 'wrong_code' });
    expect(e.status).toBe(401);
    expect(e.code).toBe('wrong_code');
    expect(e.message).toBe('wrong_code (401)');
    expect(e.body).toEqual({ error: 'wrong_code' });
  });

  it('fromResponse falls back to http_<status> when no error field', () => {
    const e = ApiError.fromResponse(500, { unexpected: true });
    expect(e.code).toBe('http_500');
  });

  it('fromResponse handles non-object body', () => {
    const e = ApiError.fromResponse(404, 'not found');
    expect(e.code).toBe('http_404');
  });

  it('network wraps an underlying cause', () => {
    const cause = new TypeError('fetch failed');
    const e = ApiError.network(cause);
    expect(e.status).toBe(0);
    expect(e.code).toBe('network_error');
    expect(e.message).toContain('fetch failed');
  });

  it('is a real Error subclass', () => {
    const e = ApiError.fromResponse(401, { error: 'x' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ApiError');
  });
});
