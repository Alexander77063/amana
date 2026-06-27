import { describe, expect, it } from 'vitest';
import { AmountText } from '../src/typography/AmountText';
import { Body } from '../src/typography/Body';
import { Caption } from '../src/typography/Caption';
import { Heading } from '../src/typography/Heading';
import { Label } from '../src/typography/Label';
import { byRole, render, textContent } from './render';

describe('Heading', () => {
  it('announces as a header by default', () => {
    const { root } = render(<Heading>Overview</Heading>);
    expect(byRole(root, 'header')).toBeTruthy();
    expect(textContent(root)).toContain('Overview');
  });

  it('can opt out of the header role', () => {
    const { root } = render(<Heading accessibilityRole="text">Plain</Heading>);
    expect(root.findAll((n) => n.props?.accessibilityRole === 'header')).toHaveLength(0);
  });
});

describe('text components render their content', () => {
  it('Label', () => {
    expect(textContent(render(<Label>Status</Label>).root)).toContain('Status');
  });
  it('Body', () => {
    expect(textContent(render(<Body>Hello there</Body>).root)).toContain('Hello there');
  });
  it('Body strong + muted variants render', () => {
    expect(
      textContent(
        render(
          <Body strong muted>
            Bold
          </Body>,
        ).root,
      ),
    ).toContain('Bold');
  });
  it('Caption', () => {
    expect(textContent(render(<Caption>small print</Caption>).root)).toContain('small print');
  });
});

describe('AmountText', () => {
  it('renders the value for each sentiment', () => {
    expect(textContent(render(<AmountText size="xl" value="₦100" />).root)).toContain('₦100');
    expect(
      textContent(render(<AmountText size="sm" value="-₦50" sentiment="debit" />).root),
    ).toContain('-₦50');
    expect(
      textContent(render(<AmountText size="md" value="+₦50" sentiment="credit" />).root),
    ).toContain('+₦50');
  });
});
