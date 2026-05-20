import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  size: 'xl' | 'lg' | 'md' | 'sm';
  value: string;
  sentiment?: 'debit' | 'credit' | 'neutral';
  style?: TextStyle;
};

export function AmountText({ size, value, sentiment = 'neutral', style }: Props) {
  const theme = useTheme();
  const color =
    sentiment === 'debit'
      ? theme.colors.debit
      : sentiment === 'credit'
        ? theme.colors.credit
        : theme.colors.text.primary;

  return (
    <Text style={[theme.type.amount[size], { color }, style]}>{value}</Text>
  );
}
