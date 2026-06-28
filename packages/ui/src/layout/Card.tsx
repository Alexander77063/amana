import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  accent?: boolean;
  children: ReactNode;
  style?: ViewStyle;
  /** When set, the card is announced as a single grouped element. */
  accessible?: boolean;
  accessibilityLabel?: string;
};

export function Card({ accent = false, children, style, accessible, accessibilityLabel }: Props) {
  const theme = useTheme();
  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          backgroundColor: theme.colors.bg.surface,
          borderRadius: 16,
          paddingVertical: 16,
          paddingHorizontal: 20,
          borderWidth: 1,
          borderColor: accent ? theme.colors.borderAccent : theme.colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
