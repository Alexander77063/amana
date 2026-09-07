import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../../lib/me';
import type { Me, Retailer } from '../../../../../lib/types';
import { __setParams } from '../../../../../test/next.mock';
import {
  byLabel,
  byRole,
  change,
  click,
  flush,
  render,
  submit,
  textContent,
} from '../../../../../test/render';

vi.mock('../../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      retailers: {
        ...real.api.retailers,
        get: vi.fn(),
        kyb: vi.fn(),
        approve: vi.fn(),
        suspend: vi.fn(),
      },
    },
  };
});
import { ApiError, api } from '../../../../../lib/api';
import RetailerPage from './page';

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

describe('retailer page', () => {
  afterEach(() => vi.clearAllMocks());

  it('submits KYB and never echoes the BVN back', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue(r);
    vi.mocked(api.retailers.kyb).mockResolvedValue({
      ...r,
      onboardingStatus: 'kyb_pending',
      anchorBusinessCustomerId: 'bc_1',
    });
    const { root } = render(
      <MeProvider me={ops}>
        <RetailerPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Owner BVN'), '12345678901');
    submit(byRole(root, 'form', 'Submit KYB'));
    await flush();
    expect(api.retailers.kyb).toHaveBeenCalledWith('r1', { bvn: '12345678901' });
    expect(textContent(root)).toContain('KYB submitted');
    expect(textContent(root)).not.toContain('12345678901');
  });

  it('explains an Anchor outage as retryable', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue(r);
    vi.mocked(api.retailers.kyb).mockRejectedValue(new ApiError(503, 'anchor_unavailable', null));
    const { root } = render(
      <MeProvider me={ops}>
        <RetailerPage />
      </MeProvider>,
    );
    await flush();
    change(byLabel(root, 'Owner BVN'), '12345678901');
    submit(byRole(root, 'form', 'Submit KYB'));
    await flush();
    expect(textContent(root)).toContain('Nothing changed; try again later.');
  });

  it('a suspended retailer gets the asymmetric banner and no approve button', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue({
      ...r,
      onboardingStatus: 'suspended',
      approvedAt: new Date().toISOString(),
    });
    const { root } = render(
      <MeProvider me={ops}>
        <RetailerPage />
      </MeProvider>,
    );
    await flush();
    expect(textContent(root)).toContain('can still redeem vouchers already sold');
    expect(() => byRole(root, 'button', 'Approve without KYB')).toThrow();
  });

  it('approving asks first', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue(r);
    vi.mocked(api.retailers.approve).mockResolvedValue({ ...r, onboardingStatus: 'approved' });
    const { root } = render(
      <MeProvider me={ops}>
        <RetailerPage />
      </MeProvider>,
    );
    await flush();
    click(byRole(root, 'button', 'Approve without KYB'));
    click(byRole(root, 'button', 'Yes, approve'));
    await flush();
    expect(api.retailers.approve).toHaveBeenCalledWith('r1');
  });
});
