import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  variant?: 'primary' | 'secondary' | 'ghost';
  onPress: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function Button({
  variant = 'primary',
  onPress,
  label,
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
}: Props) {
  const theme = useTheme();

  const bg =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'secondary'
        ? theme.colors.bg.surface
        : 'transparent';

  const textColor =
    variant === 'primary'
      ? '#0D1B2A'
      : variant === 'secondary'
        ? theme.colors.text.primary
        : theme.colors.accent;

  const borderColor =
    variant === 'secondary' ? theme.colors.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[theme.type.button, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
