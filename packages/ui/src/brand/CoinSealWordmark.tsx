import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { CoinSealMark } from './CoinSealMark';

type Props = {
  size?: number;
};

export function CoinSealWordmark({ size = 32 }: Props) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <CoinSealMark size={size} />
      <Text
        style={{
          fontFamily: 'PlusJakartaSans_700Bold',
          fontSize: size * 0.5,
          fontWeight: '700',
          letterSpacing: size * 0.16,
          color: theme.colors.text.primary,
          textTransform: 'uppercase',
        }}
      >
        AMANA
      </Text>
    </View>
  );
}
