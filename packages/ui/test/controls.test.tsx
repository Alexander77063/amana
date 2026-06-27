import { describe, expect, it } from 'vitest';
import { Button } from '../src/controls/Button';
import { IconButton } from '../src/controls/IconButton';
import { TextInput } from '../src/controls/TextInput';
import { Text } from './react-native.mock';
import { allByRole, allByType, byLabel, byRole, render, textContent } from './render';

describe('Button', () => {
  it('renders its label and exposes button role + label', () => {
    const { root } = render(<Button label="Send money" onPress={() => {}} />);
    expect(textContent(root)).toContain('Send money');
    const btn = byRole(root, 'button');
    expect(btn.props.accessibilityLabel).toBe('Send money');
  });

  it('fires onPress when activated', () => {
    let count = 0;
    const { root } = render(<Button label="Tap" onPress={() => count++} />);
    (byRole(root, 'button').props.onPress as () => void)();
    expect(count).toBe(1);
  });

  it('reflects disabled state via accessibilityState and the disabled prop', () => {
    const { root } = render(<Button label="No" onPress={() => {}} disabled />);
    const btn = byRole(root, 'button');
    expect(btn.props.disabled).toBe(true);
    expect((btn.props.accessibilityState as { disabled: boolean }).disabled).toBe(true);
  });

  it('shows a spinner and marks itself busy while loading', () => {
    const { root } = render(<Button label="Wait" onPress={() => {}} loading />);
    const btn = byRole(root, 'button');
    expect((btn.props.accessibilityState as { busy: boolean }).busy).toBe(true);
    expect(allByType(root, 'ActivityIndicator')).toHaveLength(1);
  });
});

describe('IconButton', () => {
  it('requires and exposes an accessibility label on an icon-only control', () => {
    const { root } = render(
      <IconButton accessibilityLabel="Close" onPress={() => {}}>
        <Text>×</Text>
      </IconButton>,
    );
    const btn = byRole(root, 'button');
    expect(btn.props.accessibilityLabel).toBe('Close');
    expect(btn.props.accessibilityRole).toBe('button');
  });

  it('fires onPress', () => {
    let pressed = false;
    const { root } = render(
      <IconButton
        accessibilityLabel="Scan"
        onPress={() => {
          pressed = true;
        }}
      >
        <Text>icon</Text>
      </IconButton>,
    );
    (byRole(root, 'button').props.onPress as () => void)();
    expect(pressed).toBe(true);
  });
});

describe('TextInput', () => {
  it('derives an accessibility label from the visible label', () => {
    const { root } = render(<TextInput label="Phone number" />);
    expect(byLabel(root, 'Phone number')).toBeTruthy();
    expect(textContent(root)).toContain('Phone number');
  });

  it('renders an error message when provided', () => {
    const { root } = render(<TextInput label="Amount" error="Too low" />);
    expect(textContent(root)).toContain('Too low');
  });

  it('forwards native props like keyboardType and value', () => {
    const { root } = render(<TextInput label="PIN" keyboardType="number-pad" value="1234" />);
    const input = byLabel(root, 'PIN');
    expect(input.props.keyboardType).toBe('number-pad');
    expect(input.props.value).toBe('1234');
  });

  it('lets the caller override the accessibility label', () => {
    const { root } = render(<TextInput label="x" accessibilityLabel="One-time code" />);
    expect(allByRole(root, 'button')).toHaveLength(0);
    expect(byLabel(root, 'One-time code')).toBeTruthy();
  });
});
