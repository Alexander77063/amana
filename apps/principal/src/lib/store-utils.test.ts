import { describe, expect, it } from 'vitest';
import { ApiError } from '@amana/api-client';
import { toErrorCode } from './store-utils';

describe('toErrorCode', () => {
  it('extracts code from ApiError', () => {
    const err = new ApiError('wrong_code', 401, 'wrong_code', null);
    expect(toErrorCode(err)).toBe('wrong_code');
  });

  it('extracts message from generic Error', () => {
    expect(toErrorCode(new Error('network down'))).toBe('network down');
  });

  it('returns unknown_error for non-Error values', () => {
    expect(toErrorCode('oops')).toBe('unknown_error');
    expect(toErrorCode(null)).toBe('unknown_error');
    expect(toErrorCode(42)).toBe('unknown_error');
  });
});
