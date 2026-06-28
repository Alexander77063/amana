import { describe, expect, it } from 'vitest';
import { Button } from '../src/controls/Button';
import { allByRole, render, textContent } from './render';

describe('test harness smoke', () => {
  it('renders a themed component and exposes its tree', () => {
    let pressed = false;
    const { root } = render(
      <Button
        label="Continue"
        onPress={() => {
          pressed = true;
        }}
      />,
    );
    expect(textContent(root)).toContain('Continue');
    const buttons = allByRole(root, 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    (buttons[0]?.props.onPress as () => void)();
    expect(pressed).toBe(true);
  });
});
