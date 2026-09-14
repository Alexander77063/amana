import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, Me } from '../lib/types';
import { byRole, click, flush, render, textContent } from '../test/render';

vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      approvals: { approve: vi.fn(), reject: vi.fn(), cancel: vi.fn(), list: vi.fn() },
    },
  };
});
import { api } from '../lib/api';
import { ApprovalCard } from './ApprovalCard';

const ops: Me = {
  id: 'me',
  email: 'ops2@amana-ng.com',
  displayName: null,
  roles: ['ops'],
  permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'],
};
const claim: Approval = {
  id: 'ap1',
  kind: 'vendor_approve_claim',
  status: 'pending',
  makerAdminUserId: 'm',
  makerEmail: 'ops1@amana-ng.com',
  checkerAdminUserId: null,
  checkerEmail: null,
  reason: null,
  decisionReason: null,
  decidedAt: null,
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  payload: { vendorId: 'v', phone: '+2348031234567', category: 'food' },
};

describe('ApprovalCard', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the maker seated and the checker seat empty, in plain words', () => {
    const { root } = render(
      <ApprovalCard approval={claim} subjectName="CORNER SHOP" me={ops} onDecided={() => {}} />,
    );
    const text = textContent(root);
    expect(text).toContain("Give CORNER SHOP's account to +234 803 ••• 4567");
    expect(text).toContain('ops1@amana-ng.com');
    expect(text).toContain('needs a second person');
    expect(text).toContain('in 6 days');
  });

  it('approving fills the second seat and shows the code to read to the merchant', async () => {
    vi.mocked(api.approvals.approve).mockResolvedValue({
      kind: 'vendor_approve_claim',
      publicCode: 'AMNV-7QK2H-9PZ0R',
      displayName: 'CORNER SHOP',
    });
    const onDecided = vi.fn();
    const { root } = render(
      <ApprovalCard approval={claim} subjectName="CORNER SHOP" me={ops} onDecided={onDecided} />,
    );
    click(byRole(root, 'button', 'Approve'));
    await flush();
    expect(api.approvals.approve).toHaveBeenCalledWith('ap1', undefined);
    expect(textContent(root)).toContain('AMNV-7QK2H-9PZ0R');
    expect(textContent(root)).toContain('Read this code to the merchant');
    expect(textContent(root)).toContain('ops2@amana-ng.com');
    expect(onDecided).toHaveBeenCalled();
  });

  it('the maker gets Withdraw, not Approve', () => {
    const maker: Me = { ...ops, id: 'm', email: 'ops1@amana-ng.com' };
    const { root } = render(
      <ApprovalCard approval={claim} subjectName="CORNER SHOP" me={maker} onDecided={() => {}} />,
    );
    expect(() => byRole(root, 'button', 'Approve')).toThrow();
    byRole(root, 'button', 'Withdraw');
  });

  it('someone without the deciding permission sees the line but no buttons', () => {
    const auditor: Me = {
      ...ops,
      id: 'a',
      email: 'aud@amana-ng.com',
      roles: ['auditor'],
      permissions: ['audit.read', 'iam.read', 'vendor.read', 'retailer.read'],
    };
    const { root } = render(
      <ApprovalCard approval={claim} subjectName="CORNER SHOP" me={auditor} onDecided={() => {}} />,
    );
    expect(() => byRole(root, 'button', 'Approve')).toThrow();
    expect(() => byRole(root, 'button', 'Decline')).toThrow();
  });

  it('a decided-already conflict is explained, not thrown', async () => {
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.approvals.approve).mockRejectedValue(
      new ApiError(409, 'conflict', 'approval_not_pending'),
    );
    const { root } = render(
      <ApprovalCard approval={claim} subjectName="CORNER SHOP" me={ops} onDecided={() => {}} />,
    );
    click(byRole(root, 'button', 'Approve'));
    await flush();
    expect(textContent(root)).toContain('Someone already decided this one.');
  });

  // The cron sweep and a maker's withdrawal both close an approval without ever writing a checker,
  // so a decided row can reach the card with an empty second seat. Saying "needs a second person"
  // about a row nobody can decide any more is a lie the operator would act on; the seat has to say
  // what actually happened to it.
  it('an expired row says it expired, not that it needs a second person', () => {
    const expired: Approval = {
      ...claim,
      status: 'expired',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      decidedAt: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const { root } = render(
      <ApprovalCard approval={expired} subjectName="CORNER SHOP" me={ops} onDecided={() => {}} />,
    );
    const text = textContent(root);
    expect(text).toContain('expired without a decision');
    expect(text).not.toContain('needs a second person');
    expect(() => byRole(root, 'button', 'Approve')).toThrow();
  });

  it('a withdrawn row names the withdrawal, not an empty seat', () => {
    const cancelled: Approval = {
      ...claim,
      status: 'cancelled',
      decidedAt: new Date(Date.now() - 3_600_000).toISOString(),
    };
    const { root } = render(
      <ApprovalCard approval={cancelled} subjectName="CORNER SHOP" me={ops} onDecided={() => {}} />,
    );
    const text = textContent(root);
    expect(text).toContain('withdrawn by the maker');
    expect(text).not.toContain('needs a second person');
  });
});
