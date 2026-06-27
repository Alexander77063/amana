import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { allByRole, byLabel, render, textContent } from '../../test/render';

const h = vi.hoisted(() => ({
  members: [
    { userId: 'a1', role: 'agent', status: 'active', phone: '+2348011112222', kycTier: '1' },
  ] as Array<{ userId: string; role: string; status: string; phone: string; kycTier: string }>,
}));

vi.mock('../state/household.store', () => ({
  useHouseholdStore: (sel: (s: unknown) => unknown) =>
    sel({ household: { id: 'h1' }, members: h.members, refreshMembers: () => Promise.resolve() }),
}));

vi.mock('../state/subwallets.store', () => ({
  useSubWalletsStore: (sel: (s: unknown) => unknown) =>
    sel({ create: vi.fn().mockResolvedValue(undefined), busy: false, errorCode: null }),
}));

import { CreateSubWalletScreen } from './CreateSubWalletScreen';

function props(): ComponentProps<typeof CreateSubWalletScreen> {
  return {
    navigation: { navigate: vi.fn(), goBack: vi.fn() },
    route: { params: {}, key: 'k', name: 'CreateSubWallet' },
  } as unknown as ComponentProps<typeof CreateSubWalletScreen>;
}

describe('CreateSubWalletScreen', () => {
  it('renders an accessible agent picker, name field and submit button', () => {
    h.members = [
      { userId: 'a1', role: 'agent', status: 'active', phone: '+2348011112222', kycTier: '1' },
    ];
    const { root } = render(<CreateSubWalletScreen {...props()} />);
    expect(byLabel(root, 'Agent +2348011112222, KYC tier 1')).toBeTruthy();
    expect(byLabel(root, 'SUB-WALLET NAME')).toBeTruthy();
    expect(textContent(root)).toContain('CREATE SUB-WALLET');
  });

  it('shows the empty state with a pairing CTA when there are no agents', () => {
    h.members = [];
    const { root } = render(<CreateSubWalletScreen {...props()} />);
    expect(textContent(root)).toContain('No paired agents');
    const buttons = allByRole(root, 'button');
    expect(buttons.some((b) => b.props.accessibilityLabel === 'GO TO PAIRING')).toBe(true);
  });
});
