import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../lib/me';
import type { Approval, Me } from '../../lib/types';
import { flush, render, textContent } from '../../test/render';

vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      approvals: { list: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn() },
      iam: { ...real.api.iam, admins: vi.fn() },
      vendors: { ...real.api.vendors, get: vi.fn() },
    },
  };
});
import { api } from '../../lib/api';
import InboxPage from './page';

const admin: Me = {
  id: 'me',
  email: 'admin2@amana-ng.com',
  displayName: null,
  roles: ['admin'],
  permissions: ['iam.read', 'iam.write'],
};
const grant: Approval = {
  id: 'g1',
  kind: 'role_grant',
  status: 'pending',
  makerAdminUserId: 'm',
  makerEmail: 'admin1@amana-ng.com',
  checkerAdminUserId: null,
  checkerEmail: null,
  reason: 'joining ops',
  decisionReason: null,
  decidedAt: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  payload: { targetAdminUserId: 't', role: 'ops' },
};

describe('inbox', () => {
  afterEach(() => vi.clearAllMocks());

  it('names the target of a role grant from the admin directory', async () => {
    vi.mocked(api.approvals.list).mockImplementation(async (s) => ({
      approvals: s === 'pending' ? [grant] : [],
    }));
    vi.mocked(api.iam.admins).mockResolvedValue({
      admins: [
        {
          id: 't',
          email: 'ada@amana-ng.com',
          displayName: null,
          status: 'active',
          provisioningSource: 'admin',
          lastSignedInAt: null,
          roles: [],
        },
      ],
    });
    const { root } = render(
      <MeProvider me={admin}>
        <InboxPage />
      </MeProvider>,
    );
    await flush();
    expect(textContent(root)).toContain('Make ada@amana-ng.com an ops');
    expect(textContent(root)).toContain('joining ops');
  });

  it('tells a person with no role what that means', async () => {
    vi.mocked(api.approvals.list).mockResolvedValue({ approvals: [] });
    const nobody: Me = { ...admin, roles: [], permissions: [] };
    const { root } = render(
      <MeProvider me={nobody}>
        <InboxPage />
      </MeProvider>,
    );
    await flush();
    expect(textContent(root)).toContain('no role yet');
    expect(textContent(root)).toContain('two');
  });

  it('separates waiting, yours, and decided', async () => {
    const mine = { ...grant, id: 'g2', makerAdminUserId: 'me', makerEmail: admin.email };
    const done = {
      ...grant,
      id: 'g3',
      status: 'rejected' as const,
      checkerEmail: 'x@amana-ng.com',
      decidedAt: new Date().toISOString(),
    };
    vi.mocked(api.approvals.list).mockImplementation(async (s) => ({
      approvals: s === 'pending' ? [grant, mine] : [done],
    }));
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [] });
    const { root } = render(
      <MeProvider me={admin}>
        <InboxPage />
      </MeProvider>,
    );
    await flush();
    const text = textContent(root);
    expect(text).toContain('Waiting for a second person');
    expect(text).toContain('Proposed by you');
    expect(text).toContain('Decided recently');
    expect(text).toContain('rejected');
  });
});
