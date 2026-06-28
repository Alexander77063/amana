import { describe, expect, it } from 'vitest';
import { Card } from '../src/layout/Card';
import { Divider } from '../src/layout/Divider';
import { Screen } from '../src/layout/Screen';
import { Text } from './react-native.mock';
import { allByType, byLabel, byRole, render, textContent } from './render';

describe('Card', () => {
  it('renders its children', () => {
    const { root } = render(
      <Card>
        <Text>Inside</Text>
      </Card>,
    );
    expect(textContent(root)).toContain('Inside');
  });

  it('can be announced as a grouped element', () => {
    const { root } = render(
      <Card accessible accessibilityLabel="Summary">
        <Text>x</Text>
      </Card>,
    );
    expect(byLabel(root, 'Summary')).toBeTruthy();
  });
});

describe('Divider', () => {
  it('renders without crashing', () => {
    const { root } = render(<Divider />);
    expect(allByType(root, 'View').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Screen', () => {
  it('renders a header title with header role', () => {
    const { root } = render(
      <Screen title="Home">
        <Text>Body</Text>
      </Screen>,
    );
    expect(byRole(root, 'header')).toBeTruthy();
    expect(textContent(root)).toContain('Home');
    expect(textContent(root)).toContain('Body');
  });

  it('renders header slots', () => {
    const { root } = render(
      <Screen title="Wallet" headerLeft={<Text>L</Text>} headerRight={<Text>R</Text>}>
        <Text>content</Text>
      </Screen>,
    );
    const content = textContent(root);
    expect(content).toContain('L');
    expect(content).toContain('R');
  });

  it('uses a ScrollView when scrollable', () => {
    const { root } = render(
      <Screen scrollable>
        <Text>scrolls</Text>
      </Screen>,
    );
    expect(allByType(root, 'ScrollView')).toHaveLength(1);
  });
});
