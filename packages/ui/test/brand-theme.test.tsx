import { describe, expect, it } from 'vitest';
import { CoinSealMark } from '../src/brand/CoinSealMark';
import { CoinSealWordmark } from '../src/brand/CoinSealWordmark';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { Text } from './react-native.mock';
import { allByType, render, textContent } from './render';

describe('brand marks', () => {
  it('CoinSealMark renders an Svg for each variant', () => {
    for (const variant of ['default', 'agent', 'principal', 'mono-light', 'mono-white'] as const) {
      const { root } = render(<CoinSealMark size={40} variant={variant} />);
      expect(allByType(root, 'Svg').length).toBeGreaterThanOrEqual(1);
    }
  });

  it('CoinSealWordmark renders the wordmark text', () => {
    const { root } = render(<CoinSealWordmark size={32} />);
    expect(textContent(root)).toContain('AMANA');
  });
});

describe('ThemeProvider', () => {
  it('renders children once fonts are loaded', () => {
    const { root } = render(
      <ThemeProvider fontsLoaded>
        <Text>themed</Text>
      </ThemeProvider>,
    );
    expect(textContent(root)).toContain('themed');
  });

  it('renders a placeholder (no children) while fonts load', () => {
    // render() wraps in its own ThemeProvider; mount a second inner one not-loaded.
    const { root } = render(
      <ThemeProvider fontsLoaded={false}>
        <Text>should not show</Text>
      </ThemeProvider>,
    );
    expect(textContent(root)).not.toContain('should not show');
  });
});
