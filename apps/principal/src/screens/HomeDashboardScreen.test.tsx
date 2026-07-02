import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { allByLabel, byLabel, render, textContent } from '../../test/render';

const hh = vi.hoisted(() => ({ feesCoveredKobo: '482000' as string | undefined }));

vi.mock('../state/household.store', () => ({
  useHouseholdStore: (sel: (s: unknown) => unknown) =>
    sel({
      status: 'has_household',
      household: { id: 'h1', name: 'Adegbola household' },
      masterWallet: {
        anchorVirtualAccount: '1234567890',
        anchorBankCode: '058',
        feesCoveredKobo: hh.feesCoveredKobo,
      },
      members: [{ userId: 'a1' }],
      errorCode: null,
      bootstrap: vi.fn(),
    }),
}));

vi.mock('../state/bumps.store', () => ({
  useBumpsStore: (sel: (s: unknown) => unknown) =>
    sel({ refresh: vi.fn(), pending: [{ id: 'b1' }] }),
}));

vi.mock('../state/notifications.store', () => ({
  useNotificationsStore: (sel: (s: unknown) => unknown) =>
    sel({ refresh: vi.fn(), unreadCount: 2 }),
}));

import { HomeDashboardScreen } from './HomeDashboardScreen';

function props(): ComponentProps<typeof HomeDashboardScreen> {
  return {
    navigation: { navigate: vi.fn(), replace: vi.fn() },
    route: { params: {}, key: 'k', name: 'HomeDashboard' },
  } as unknown as ComponentProps<typeof HomeDashboardScreen>;
}

describe('HomeDashboardScreen', () => {
  const HERO_LABEL =
    "₦4,820.00 in bank fees covered. Amana covers the bank's funding fee, so every naira you load lands.";

  it('renders navigation cards as accessible buttons with descriptive labels', () => {
    hh.feesCoveredKobo = '482000';
    const { root } = render(<HomeDashboardScreen {...props()} />);
    expect(textContent(root)).toContain('Adegbola household');
    expect(byLabel(root, 'Pending requests, 1 waiting')).toBeTruthy();
    expect(byLabel(root, 'Notifications, 2 unread')).toBeTruthy();
    expect(byLabel(root, 'Agents, 1 paired')).toBeTruthy();
    expect(byLabel(root, 'Sub-wallets')).toBeTruthy();
    expect(byLabel(root, 'Pair an agent')).toBeTruthy();
    expect(byLabel(root, 'Settings')).toBeTruthy();
  });

  it('shows the fee-cover hero card with the formatted lifetime total', () => {
    hh.feesCoveredKobo = '482000';
    const { root } = render(<HomeDashboardScreen {...props()} />);
    expect(textContent(root)).toContain('₦4,820.00');
    expect(byLabel(root, HERO_LABEL)).toBeTruthy();
  });

  it('hides the hero card when fees covered is zero', () => {
    hh.feesCoveredKobo = '0';
    const { root } = render(<HomeDashboardScreen {...props()} />);
    expect(allByLabel(root, HERO_LABEL)).toHaveLength(0);
    // Rest of the dashboard is intact.
    expect(byLabel(root, 'Settings')).toBeTruthy();
  });

  it('hides the hero card when fees covered is absent', () => {
    hh.feesCoveredKobo = undefined;
    const { root } = render(<HomeDashboardScreen {...props()} />);
    expect(allByLabel(root, HERO_LABEL)).toHaveLength(0);
  });
});
