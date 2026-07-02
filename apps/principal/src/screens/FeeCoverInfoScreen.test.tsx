import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, textContent } from '../../test/render';
import { FeeCoverInfoScreen } from './FeeCoverInfoScreen';

function props(): ComponentProps<typeof FeeCoverInfoScreen> {
  return {
    navigation: { navigate: vi.fn(), goBack: vi.fn() },
    route: { params: undefined, key: 'k', name: 'FeeCoverInfo' },
  } as unknown as ComponentProps<typeof FeeCoverInfoScreen>;
}

describe('FeeCoverInfoScreen', () => {
  it('renders the title and explainer copy', () => {
    const { root } = render(<FeeCoverInfoScreen {...props()} />);
    const content = textContent(root);
    expect(content).toContain('Every naira lands');
    expect(content).toContain('Amana absorbs that fee');
  });
});
