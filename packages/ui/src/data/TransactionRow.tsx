import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { AmountText } from '../typography/AmountText';
import { Body } from '../typography/Body';
import { Caption } from '../typography/Caption';

type Props = {
  merchant: string;
  timestamp: string;
  amount: string;
  sentiment: 'debit' | 'credit';
  onPress?: () => void;
};

export function TransactionRow({ merchant, timestamp, amount, sentiment, onPress }: Props) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 20,
        backgroundColor: pressed ? theme.colors.bg.raised : 'transparent',
      })}
    >
      <View style={{ flex: 1, marginRight: 8 }}>
        <Body strong>{merchant}</Body>
        <Caption>{timestamp}</Caption>
      </View>
      <AmountText size="sm" value={amount} sentiment={sentiment} />
    </Pressable>
  );
}
