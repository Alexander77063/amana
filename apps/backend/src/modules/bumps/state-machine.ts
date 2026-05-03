import { type Result, err, ok } from '../../lib/result';

export type BumpState = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired';

export type BumpEvent =
  | { kind: 'approve_once' }
  | { kind: 'approve_raise_limit' }
  | { kind: 'deny' }
  | { kind: 'expire' }
  | { kind: 'agent_cancel' };

export type TransitionError = { code: 'INVALID_TRANSITION'; from: BumpState; event: BumpEvent };

export function transition(state: BumpState, event: BumpEvent): Result<BumpState, TransitionError> {
  if (state !== 'pending') {
    return err({ code: 'INVALID_TRANSITION', from: state, event });
  }
  switch (event.kind) {
    case 'approve_once':
      return ok('approved_once');
    case 'approve_raise_limit':
      return ok('raise_limit');
    case 'deny':
    case 'agent_cancel':
      return ok('denied');
    case 'expire':
      return ok('expired');
  }
}
