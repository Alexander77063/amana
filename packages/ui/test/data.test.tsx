import { describe, expect, it } from 'vitest';
import { BalanceCard } from '../src/data/BalanceCard';
import { SectionHeader } from '../src/data/SectionHeader';
import { TransactionRow } from '../src/data/TransactionRow';
import { byLabel, byRole, render, textContent } from './render';

describe('BalanceCard', () => {
  it('renders the label and amount', () => {
    const { root } = render(<BalanceCard label="Wallet balance" amount="₦12,300.00" />);
    const content = textContent(root);
    expect(content).toContain('Wallet balance');
    expect(content).toContain('₦12,300.00');
  });

  it('announces label, amount and trend as one grouped label', () => {
    const { root } = render(
      <BalanceCard label="Balance" amount="₦5,000" trend="+2%" trendSentiment="positive" />,
    );
    expect(byLabel(root, 'Balance, ₦5,000, +2%')).toBeTruthy();
  });
});

describe('TransactionRow', () => {
  it('builds a descriptive accessibility label from merchant, amount and time', () => {
    const { root } = render(
      <TransactionRow merchant="MTN" timestamp="2:14 PM" amount="₦500" sentiment="debit" />,
    );
    expect(byLabel(root, 'MTN, debit ₦500, 2:14 PM')).toBeTruthy();
    expect(textContent(root)).toContain('MTN');
  });

  it('is a button and fires onPress when interactive', () => {
    let opened = false;
    const { root } = render(
      <TransactionRow
        merchant="Shoprite"
        timestamp="Today"
        amount="₦9,000"
        sentiment="credit"
        onPress={() => {
          opened = true;
        }}
      />,
    );
    const row = byRole(root, 'button');
    (row.props.onPress as () => void)();
    expect(opened).toBe(true);
  });
});

describe('SectionHeader', () => {
  it('renders its title with a header role', () => {
    const { root } = render(<SectionHeader title="Recent activity" />);
    expect(byRole(root, 'header').props.accessibilityLabel).toBe('Recent activity');
    expect(textContent(root)).toContain('Recent activity');
  });
});
