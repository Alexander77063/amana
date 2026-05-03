import { describe, expect, it } from 'vitest';
import {
  formatAgentNarration,
  formatPrincipalNarration,
  hashAgentReference,
  selectNarration,
} from '../../../src/integrations/anchor/narration';

describe('narration formatter (Decisions #15, #17)', () => {
  it('hashAgentReference produces a stable 5-char alphanumeric token', () => {
    const a = hashAgentReference('user-abc');
    const b = hashAgentReference('user-abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-z0-9]{5}$/);
    expect(hashAgentReference('user-xyz')).not.toBe(a);
  });

  it('formatAgentNarration uses AMN/AGT/<hash> + household ref', () => {
    expect(formatAgentNarration('hh-12345', 'user-abc')).toMatch(/^AMN\/AGT\/[a-z0-9]{5}\/hh-12345$/);
  });

  it('formatPrincipalNarration uses AMN/<householdRef>', () => {
    expect(formatPrincipalNarration('hh-12345')).toBe('AMN/hh-12345');
  });

  it('selectNarration picks principal form when subWalletId is null', () => {
    expect(selectNarration({ householdRef: 'hh-1', agentUserId: null })).toBe('AMN/hh-1');
  });

  it('selectNarration picks agent form when agentUserId is set', () => {
    const out = selectNarration({ householdRef: 'hh-1', agentUserId: 'user-x' });
    expect(out).toMatch(/^AMN\/AGT\/[a-z0-9]{5}\/hh-1$/);
  });

  it('truncates narration to 64 chars (NIP narration limit)', () => {
    const longHh = 'h'.repeat(80);
    const out = formatPrincipalNarration(longHh);
    expect(out.length).toBeLessThanOrEqual(64);
  });
});
