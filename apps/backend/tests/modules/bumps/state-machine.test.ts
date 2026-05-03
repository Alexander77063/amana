import { describe, expect, it } from 'vitest';
import { transition, type BumpEvent, type BumpState } from '../../../src/modules/bumps/state-machine';
import { isErr, isOk } from '../../../src/lib/result';

describe('bump state machine', () => {
  it('pending → approved_once on approve_once', () => {
    const r = transition('pending' satisfies BumpState, { kind: 'approve_once' } satisfies BumpEvent);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe('approved_once');
  });

  it('pending → raise_limit on approve_raise_limit', () => {
    const r = transition('pending', { kind: 'approve_raise_limit' });
    if (isOk(r)) expect(r.value).toBe('raise_limit');
  });

  it('pending → denied on deny', () => {
    const r = transition('pending', { kind: 'deny' });
    if (isOk(r)) expect(r.value).toBe('denied');
  });

  it('pending → expired on expire', () => {
    const r = transition('pending', { kind: 'expire' });
    if (isOk(r)) expect(r.value).toBe('expired');
  });

  it('rejects approve from a terminal state (approved_once)', () => {
    const r = transition('approved_once', { kind: 'approve_once' });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('rejects expire from a terminal state', () => {
    expect(isErr(transition('denied', { kind: 'expire' }))).toBe(true);
    expect(isErr(transition('approved_once', { kind: 'expire' }))).toBe(true);
  });
});
