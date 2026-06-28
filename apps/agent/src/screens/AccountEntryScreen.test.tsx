import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byLabel, render, textContent } from '../../test/render';

vi.mock('../lib/api', () => ({
  api: {
    vendor: {
      nameEnquiry: vi.fn().mockResolvedValue({
        accountName: 'MUSA',
        bankCode: '058',
        accountNumber: '0123456789',
      }),
    },
  },
}));

vi.mock('../state/agent.store', () => {
  const state = { selectedSubWallet: { id: 'sw1', name: 'Driver' } };
  const useAgentStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    { getState: () => state },
  );
  return { useAgentStore };
});

import { AccountEntryScreen } from './AccountEntryScreen';

function props(): ComponentProps<typeof AccountEntryScreen> {
  return {
    navigation: { navigate: vi.fn() },
    route: { params: {}, key: 'k', name: 'AccountEntry' },
  } as unknown as ComponentProps<typeof AccountEntryScreen>;
}

describe('AccountEntryScreen', () => {
  it('renders the form with an accessible bank selector and account input', () => {
    const { root } = render(<AccountEntryScreen {...props()} />);
    expect(byLabel(root, 'Select bank')).toBeTruthy();
    expect(byLabel(root, 'ACCOUNT NUMBER')).toBeTruthy();
    expect(textContent(root)).toContain('CONFIRM NAME');
  });
});
