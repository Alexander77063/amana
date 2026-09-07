import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../lib/me';
import type { Me, Retailer } from '../../../../lib/types';
import {
  allByRole,
  byLabel,
  byRole,
  change,
  click,
  flush,
  render,
  submit,
  textContent,
} from '../../../../test/render';

vi.mock('../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../lib/api')>();
  return {
    ...real,
    api: { ...real.api, retailers: { ...real.api.retailers, list: vi.fn(), create: vi.fn() } },
  };
});
import { api } from '../../../../lib/api';
import RetailersPage from './page';

const ops: Me = {
  id: 'me',
  email: 'ops@amana-ng.com',
  displayName: null,
  roles: ['ops'],
  permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'],
};
const r: Retailer = {
  id: 'r1',
  businessName: 'Bola Tyres',
  anchorBusinessCustomerId: null,
  payoutBankCode: '058',
  payoutAccountNumber: '0123456789',
  onboardingStatus: 'applied',
  ownerUserId: null,
  contactPhone: null,
  approvedAt: null,
  createdAt: new Date().toISOString(),
};

describe('retailers', () => {
  afterEach(() => vi.clearAllMocks());

  it('lists by status, defaulting to applied', async () => {
    vi.mocked(api.retailers.list).mockResolvedValue([r]);
    const { root } = render(
      <MeProvider me={ops}>
        <RetailersPage />
      </MeProvider>,
    );
    await flush();
    expect(api.retailers.list).toHaveBeenCalledWith('applied');
    expect(allByRole(root, 'link', 'Bola Tyres').length).toBe(1);
  });

  it('switches status tabs', async () => {
    vi.mocked(api.retailers.list).mockResolvedValue([]);
    const { root } = render(
      <MeProvider me={ops}>
        <RetailersPage />
      </MeProvider>,
    );
    await flush();
    click(byRole(root, 'button', 'approved'));
    await flush();
    expect(api.retailers.list).toHaveBeenLastCalledWith('approved');
  });

  it('creates a retailer from the form', async () => {
    vi.mocked(api.retailers.list).mockResolvedValue([]);
    vi.mocked(api.retailers.create).mockResolvedValue({ ...r, id: 'r2' });
    const { root } = render(
      <MeProvider me={ops}>
        <RetailersPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Business name'), 'Mama Put');
    change(byLabel(root, 'Payout bank code'), '058');
    change(byLabel(root, 'Payout account number'), '0123456789');
    submit(byRole(root, 'form', 'Add a retailer'));
    await flush();
    expect(api.retailers.create).toHaveBeenCalledWith({
      businessName: 'Mama Put',
      payoutBankCode: '058',
      payoutAccountNumber: '0123456789',
    });
    expect(textContent(root)).toContain('Added. Next: submit their KYB from their page.');
  });
});
