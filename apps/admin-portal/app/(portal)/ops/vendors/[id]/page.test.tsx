import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../../lib/me';
import type { Me, VendorSummary } from '../../../../../lib/types';
import { __setParams } from '../../../../../test/next.mock';
import {
  byLabel,
  byRole,
  change,
  click,
  flush,
  render,
  textContent,
} from '../../../../../test/render';

vi.mock('../../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      vendors: {
        ...real.api.vendors,
        get: vi.fn(),
        consents: vi.fn(),
        setCategory: vi.fn(),
        suspend: vi.fn(),
        revokeConsent: vi.fn(),
        setEnforcement: vi.fn(),
      },
    },
  };
});
import { api } from '../../../../../lib/api';
import VendorPage from './page';

const ops: Me = {
  id: 'me',
  email: 'ops@amana-ng.com',
  displayName: null,
  roles: ['ops'],
  permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'],
};
const vendor: VendorSummary = {
  id: 'v1',
  displayName: 'CORNER SHOP',
  bankCode: '058',
  accountNumberMasked: '••••6789',
  status: 'claimed',
  category: 'food',
  categorySource: 'claimed',
  publicCode: 'AMNV-7QK2H-9PZ0R',
  promotedHouseholdCount: 6,
  promotedAt: new Date().toISOString(),
  claimedAt: new Date().toISOString(),
};

describe('vendor page', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows identity, status and consents, with nothing unmasked', async () => {
    __setParams({ id: 'v1' });
    vi.mocked(api.vendors.get).mockResolvedValue({ vendor, claimAttempts: [] });
    vi.mocked(api.vendors.consents).mockResolvedValue({
      current: {
        service_terms: {
          id: 'c',
          purpose: 'service_terms',
          granted: true,
          termsVersion: '2026-08-27.v1',
          source: 'claim',
          recordedAt: new Date().toISOString(),
        },
      },
      history: [],
    });
    const { root } = render(
      <MeProvider me={ops}>
        <VendorPage />
      </MeProvider>,
    );
    await flush();
    const text = textContent(root);
    expect(text).toContain('CORNER SHOP');
    expect(text).toContain('AMNV-7QK2H-9PZ0R');
    expect(text).toContain('claimed');
    expect(text).toContain('Service terms');
    expect(text).toContain('granted');
  });

  it('suspending asks first and names the consequence', async () => {
    __setParams({ id: 'v1' });
    vi.mocked(api.vendors.get).mockResolvedValue({ vendor, claimAttempts: [] });
    vi.mocked(api.vendors.consents).mockResolvedValue({ current: {}, history: [] });
    vi.mocked(api.vendors.suspend).mockResolvedValue({ ok: true });
    const { root } = render(
      <MeProvider me={ops}>
        <VendorPage />
      </MeProvider>,
    );
    await flush();
    click(byRole(root, 'button', 'Suspend CORNER SHOP'));
    expect(textContent(root)).toContain('stops new spends to this account at once');
    click(byRole(root, 'button', 'Yes, suspend'));
    await flush();
    expect(api.vendors.suspend).toHaveBeenCalledWith('v1');
  });

  it('sets a category, which outranks the merchant’s own', async () => {
    __setParams({ id: 'v1' });
    vi.mocked(api.vendors.get).mockResolvedValue({ vendor, claimAttempts: [] });
    vi.mocked(api.vendors.consents).mockResolvedValue({ current: {}, history: [] });
    vi.mocked(api.vendors.setCategory).mockResolvedValue({ ok: true });
    const { root } = render(
      <MeProvider me={ops}>
        <VendorPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Category'), 'transport');
    click(byRole(root, 'button', 'Save category'));
    await flush();
    expect(api.vendors.setCategory).toHaveBeenCalledWith('v1', 'transport');
  });
});
