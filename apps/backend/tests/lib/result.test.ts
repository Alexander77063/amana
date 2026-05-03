import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok, type Result } from '../../src/lib/result';

describe('Result', () => {
  it('ok wraps a value and is_ok narrows', () => {
    const r: Result<number, string> = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) {
      expect(r.value).toBe(42);
    }
  });

  it('err wraps an error and is_err narrows', () => {
    const r: Result<number, string> = err('boom');
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (isErr(r)) {
      expect(r.error).toBe('boom');
    }
  });
});
