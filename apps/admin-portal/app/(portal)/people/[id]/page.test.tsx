import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../lib/me';
import type { AdminSummary, Me } from '../../../../lib/types';
import { __setParams } from '../../../../test/next.mock';
import {
  byLabel,
  byRole,
  change,
  click,
  flush,
  render,
  textContent,
} from '../../../../test/render';

vi.mock('../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      iam: { ...real.api.iam, admins: vi.fn(), grants: vi.fn(), grant: vi.fn(), revoke: vi.fn() },
    },
  };
});
import { api } from '../../../../lib/api';
import PersonPage from './page';

const admin: Me = {
  id: 'me',
  email: 'admin@amana-ng.com',
  displayName: null,
  roles: ['admin'],
  permissions: ['iam.read', 'iam.write'],
};
const ada: AdminSummary = {
  id: 'a',
  email: 'ada@amana-ng.com',
  displayName: null,
  status: 'active',
  provisioningSource: 'admin',
  lastSignedInAt: null,
  roles: ['ops'],
};

describe('person page', () => {
  afterEach(() => vi.clearAllMocks());

  it('proposing a grant says it needs a second admin', async () => {
    __setParams({ id: 'a' });
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [ada] });
    vi.mocked(api.iam.grants).mockResolvedValue({ grants: [] });
    vi.mocked(api.iam.grant).mockResolvedValue({ approvalId: 'ap', status: 'pending' });
    const { root } = render(
      <MeProvider me={admin}>
        <PersonPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Role to add'), 'support');
    change(byLabel(root, 'Why'), 'joining support');
    click(byRole(root, 'button', 'Propose'));
    await flush();
    expect(api.iam.grant).toHaveBeenCalledWith('a', 'support', 'joining support');
    expect(textContent(root)).toContain('Proposed. A second admin has to approve it in the inbox.');
  });

  it('the bootstrap account is told its grant applied at once', async () => {
    __setParams({ id: 'a' });
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [ada] });
    vi.mocked(api.iam.grants).mockResolvedValue({ grants: [] });
    vi.mocked(api.iam.grant).mockResolvedValue({ approvalId: 'ap', status: 'approved' });
    const { root } = render(
      <MeProvider me={admin}>
        <PersonPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Role to add'), 'support');
    click(byRole(root, 'button', 'Propose'));
    await flush();
    expect(textContent(root)).toContain('Applied at once');
  });

  it('revoking is immediate and asks first', async () => {
    __setParams({ id: 'a' });
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [ada] });
    vi.mocked(api.iam.grants).mockResolvedValue({
      grants: [
        {
          role: 'ops',
          granted: true,
          grantedByAdminUserId: 'x',
          source: 'admin',
          reason: 'hired',
          recordedAt: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(api.iam.revoke).mockResolvedValue(undefined);
    const { root } = render(
      <MeProvider me={admin}>
        <PersonPage />
      </MeProvider>,
    );
    await flush();
    click(byRole(root, 'button', 'Revoke ops'));
    click(byRole(root, 'button', 'Yes, revoke'));
    await flush();
    expect(api.iam.revoke).toHaveBeenCalledWith('a', 'ops', undefined);
  });

  it('you cannot change your own roles, and the page says so', async () => {
    __setParams({ id: 'me' });
    vi.mocked(api.iam.admins).mockResolvedValue({
      admins: [{ ...ada, id: 'me', email: admin.email, roles: ['admin'] }],
    });
    vi.mocked(api.iam.grants).mockResolvedValue({ grants: [] });
    const { root } = render(
      <MeProvider me={admin}>
        <PersonPage />
      </MeProvider>,
    );
    await flush();
    expect(textContent(root)).toContain("You can't change your own roles");
    expect(() => byRole(root, 'button', 'Propose')).toThrow();
  });
});
