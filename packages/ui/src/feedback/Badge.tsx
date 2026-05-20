import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  count?: number;
  variant?: 'success' | 'error' | 'warning' | 'neutral';
  label?: string;
};

export function Badge({ count, variant = 'neutral', label }: Props) {
  const theme = useTheme();

  const bg =
    variant === 'success'
      ? theme.colors.credit
      : variant === 'error'
        ? theme.colors.debit
        : variant === 'warning'
          ? theme.colors.accent
          : theme.colors.bg.raised;

  const textColor =
    variant === 'warning' ? '#0D1B2A' : theme.colors.text.primary;

  const text = count !== undefined ? String(count) : label ?? '';

  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={[
          theme.type.caption,
          { color: textColor, fontFamily: 'PlusJakartaSans_700Bold' },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
