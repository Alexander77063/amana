import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { describeApproval, errorMessage, maskPhone, relativeTime } from './copy';

describe('errorMessage', () => {
  it('never explains a 403 beyond permission', () => {
    expect(errorMessage(new ApiError(403, 'forbidden', null))).toBe(
      "You don't have permission for that.",
    );
  });
  it('names the decided-already case', () => {
    expect(errorMessage(new ApiError(409, 'conflict', 'approval_not_pending'))).toBe(
      'Someone already decided this one.',
    );
  });
  it('explains a lost backend', () => {
    expect(errorMessage(new ApiError(502, 'backend_unreachable', null))).toMatch(
      /could not reach/i,
    );
  });
  it('falls back to a plain sentence', () => {
    expect(errorMessage(new Error('x'))).toBe('Something went wrong. Try again.');
  });
});

describe('describeApproval', () => {
  it('says what a role grant does', () => {
    expect(
      describeApproval(
        {
          id: '1',
          kind: 'role_grant',
          status: 'pending',
          makerAdminUserId: 'm',
          makerEmail: 'a@amana-ng.com',
          checkerAdminUserId: null,
          checkerEmail: null,
          reason: null,
          decisionReason: null,
          decidedAt: null,
          expiresAt: '2026-09-14T00:00:00Z',
          createdAt: '2026-09-07T00:00:00Z',
          payload: { targetAdminUserId: 't', role: 'admin' },
        },
        'ada@amana-ng.com',
      ),
    ).toBe('Make ada@amana-ng.com an admin');
  });
  it('says what a vendor claim does, with the phone masked', () => {
    expect(
      describeApproval(
        {
          id: '1',
          kind: 'vendor_approve_claim',
          status: 'pending',
          makerAdminUserId: 'm',
          makerEmail: 'a@amana-ng.com',
          checkerAdminUserId: null,
          checkerEmail: null,
          reason: null,
          decisionReason: null,
          decidedAt: null,
          expiresAt: '2026-09-14T00:00:00Z',
          createdAt: '2026-09-07T00:00:00Z',
          payload: { vendorId: 'v', phone: '+2348031234567', category: 'food' },
        },
        'CORNER SHOP',
      ),
    ).toBe("Give CORNER SHOP's account to +234 803 ••• 4567");
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  it('reads forwards and backwards', () => {
    expect(relativeTime('2026-09-13T12:00:00Z', now)).toBe('in 6 days');
    expect(relativeTime('2026-09-07T11:15:00Z', now)).toBe('45 minutes ago');
    expect(relativeTime('2026-09-07T11:59:40Z', now)).toBe('just now');
  });
});

describe('maskPhone', () => {
  it('keeps country code, prefix and last four', () => {
    expect(maskPhone('+2348031234567')).toBe('+234 803 ••• 4567');
  });
});
