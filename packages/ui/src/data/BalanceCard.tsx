import { View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Card } from '../layout/Card';
import { AmountText } from '../typography/AmountText';
import { Label } from '../typography/Label';
import { Caption } from '../typography/Caption';

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

  return (
    <Card accent>
      <Label>{label}</Label>
      <AmountText size="xl" value={amount} style={{ marginTop: 4, marginBottom: 4 }} />
      {trend ? <Caption style={{ color: trendColor }}>{trend}</Caption> : null}
    </Card>
  );
}
