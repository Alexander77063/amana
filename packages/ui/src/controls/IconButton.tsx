import type { ReactNode } from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  onPress: () => void;
  children: ReactNode;
  /** Required — icon-only controls have no visible text for screen readers. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
  style?: ViewStyle;
};

export function IconButton({
  onPress,
  children,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  style,
}: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          padding: 8,
          borderRadius: 8,
          backgroundColor: pressed ? theme.colors.accentDim : 'transparent',
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
