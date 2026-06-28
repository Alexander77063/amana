import { View } from 'react-native';
import { Card } from '../layout/Card';
import { useTheme } from '../theme/ThemeContext';
import { AmountText } from '../typography/AmountText';
import { Caption } from '../typography/Caption';
import { Label } from '../typography/Label';

type Props = {
  label: string;
  amount: string;
  trend?: string;
  trendSentiment?: 'positive' | 'negative';
};

export function BalanceCard({ label, amount, trend, trendSentiment }: Props) {
  const theme = useTheme();
  const trendColor =
    trendSentiment === 'positive'
      ? theme.colors.credit
      : trendSentiment === 'negative'
        ? theme.colors.debit
        : theme.colors.text.muted;

  const a11yLabel = [label, amount, trend].filter(Boolean).join(', ');

  return (
    <Card accent accessible accessibilityLabel={a11yLabel}>
      <Label>{label}</Label>
      <AmountText size="xl" value={amount} style={{ marginTop: 4, marginBottom: 4 }} />
      {trend ? <Caption style={{ color: trendColor }}>{trend}</Caption> : null}
    </Card>
  );
}
