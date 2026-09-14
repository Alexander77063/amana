import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../lib/me';
import type { ClaimAttempt, Me, VendorSummary } from '../../../../lib/types';
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
    api: {
      ...real.api,
      vendors: { ...real.api.vendors, queue: vi.fn(), search: vi.fn(), proposeClaim: vi.fn() },
    },
  };
});
import { api } from '../../../../lib/api';
import VendorsPage from './page';

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
  status: 'observed',
  category: null,
  categorySource: 'observed',
  publicCode: null,
  promotedHouseholdCount: 6,
  promotedAt: new Date().toISOString(),
  claimedAt: null,
};
const attempt: ClaimAttempt = {
  id: 'c1',
  vendorId: 'v1',
  phone: '+2348031234567',
  status: 'pending',
  ownershipProof: null,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  verifiedAt: null,
  createdAt: new Date().toISOString(),
  vendor,
};

describe('vendors', () => {
  afterEach(() => vi.clearAllMocks());

  it('lists the claim queue with the business named and the account masked', async () => {
    vi.mocked(api.vendors.queue).mockResolvedValue({ attempts: [attempt] });
    vi.mocked(api.vendors.search).mockResolvedValue({ vendors: [] });
    const { root } = render(
      <MeProvider me={ops}>
        <VendorsPage />
      </MeProvider>,
    );
    await flush();
    const text = textContent(root);
    expect(text).toContain('CORNER SHOP');
    expect(text).toContain('••••6789');
    expect(text).toContain('+234 803 ••• 4567');
  });

  it('proposes approval for a queued claim and points at the inbox', async () => {
    vi.mocked(api.vendors.queue).mockResolvedValue({ attempts: [attempt] });
    vi.mocked(api.vendors.search).mockResolvedValue({ vendors: [] });
    vi.mocked(api.vendors.proposeClaim).mockResolvedValue({ approvalId: 'ap', status: 'pending' });
    const { root } = render(
      <MeProvider me={ops}>
        <VendorsPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Category for CORNER SHOP'), 'food');
    click(byRole(root, 'button', 'Propose approval for CORNER SHOP'));
    await flush();
    expect(api.vendors.proposeClaim).toHaveBeenCalledWith('v1', '+2348031234567', 'food');
    expect(textContent(root)).toContain(
      'Proposed. A second ops colleague has to approve it in the inbox.',
    );
  });

  it('searches vendors by name', async () => {
    vi.mocked(api.vendors.queue).mockResolvedValue({ attempts: [] });
    vi.mocked(api.vendors.search).mockResolvedValue({ vendors: [vendor] });
    const { root } = render(
      <MeProvider me={ops}>
        <VendorsPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Search by name or code'), 'corner');
    submit(byRole(root, 'form', 'Find a vendor'));
    await flush();
    expect(api.vendors.search).toHaveBeenLastCalledWith(undefined, 'corner');
    expect(allByRole(root, 'link', 'CORNER SHOP').length).toBe(1);
  });
});
