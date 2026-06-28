import { describe, expect, it } from 'vitest';
import { Badge } from '../src/feedback/Badge';
import { Skeleton } from '../src/feedback/Skeleton';
import { allByType, byLabel, render, textContent } from './render';

describe('Badge', () => {
  it('renders a count', () => {
    const { root } = render(<Badge count={3} />);
    expect(textContent(root)).toContain('3');
  });

  it('renders a label when no count is given', () => {
    const { root } = render(<Badge label="NEW" variant="success" />);
    expect(textContent(root)).toContain('NEW');
  });

  it('exposes a spoken accessibility label when provided', () => {
    const { root } = render(<Badge count={3} accessibilityLabel="3 pending approvals" />);
    expect(byLabel(root, '3 pending approvals')).toBeTruthy();
  });
});

describe('Skeleton', () => {
  it('renders and is hidden from assistive technology', () => {
    const { root } = render(<Skeleton width={120} height={20} />);
    const node = allByType(root, 'Animated.View')[0];
    expect(node).toBeTruthy();
    expect(node?.props.accessibilityElementsHidden).toBe(true);
    expect(node?.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(node?.props.accessible).toBe(false);
  });

  it('unmounts cleanly (stops its loop animation)', () => {
    const { unmount } = render(<Skeleton />);
    expect(() => unmount()).not.toThrow();
  });
});
