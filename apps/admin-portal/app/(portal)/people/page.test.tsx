import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../lib/me';
import type { AdminSummary, Me } from '../../../lib/types';
import {
  allByRole,
  byLabel,
  byRole,
  change,
  flush,
  render,
  submit,
  textContent,
} from '../../../test/render';

vi.mock('../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../lib/api')>();
  return {
    ...real,
    api: { ...real.api, iam: { ...real.api.iam, admins: vi.fn(), onboard: vi.fn() } },
  };
});
import { api } from '../../../lib/api';
import PeoplePage from './page';

const admin: Me = {
  id: 'me',
  email: 'admin@amana-ng.com',
  displayName: null,
  roles: ['admin'],
  permissions: ['iam.read', 'iam.write'],
};
const david: AdminSummary = {
  id: 'd',
  email: 'david@amana-ng.com',
  displayName: 'david williams',
  status: 'active',
  provisioningSource: 'config',
  lastSignedInAt: new Date().toISOString(),
  roles: ['owner', 'admin'],
};

describe('people', () => {
  afterEach(() => vi.clearAllMocks());

  it('lists everyone with roles and marks the break-glass account', async () => {
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [david] });
    const { root } = render(
      <MeProvider me={admin}>
        <PeoplePage />
      </MeProvider>,
    );
    await flush();
    const text = textContent(root);
    expect(allByRole(root, 'link', 'david@amana-ng.com').length).toBe(1);
    expect(text).toContain('owner, admin');
    expect(text).toContain('seeded from config');
  });

  it('onboards by email and says the new person has no role yet', async () => {
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [] });
    vi.mocked(api.iam.onboard).mockResolvedValue({ id: 'n', email: 'ada@amana-ng.com', roles: [] });
    const { root } = render(
      <MeProvider me={admin}>
        <PeoplePage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Work email'), 'ada@amana-ng.com');
    submit(byRole(root, 'form', 'Add a person'));
    await flush();
    expect(api.iam.onboard).toHaveBeenCalledWith('ada@amana-ng.com');
    expect(textContent(root)).toContain('no role yet');
  });

  it('an auditor sees the list but no onboarding form', async () => {
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [david] });
    const auditor: Me = {
      ...admin,
      roles: ['auditor'],
      permissions: ['audit.read', 'iam.read', 'vendor.read', 'retailer.read'],
    };
    const { root } = render(
      <MeProvider me={auditor}>
        <PeoplePage />
      </MeProvider>,
    );
    await flush();
    expect(allByRole(root, 'form')).toHaveLength(0);
  });
});
