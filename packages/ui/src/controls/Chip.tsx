import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Selected state reads as a denial (blocklist membership) rather than an approval. */
  tone?: 'accent' | 'debit';
  style?: ViewStyle;
};

/**
 * A small selectable pill, for choosing several things out of a set — spend categories, days
 * of the week. Selection is carried by fill and border rather than a tick, so a row of these
 * stays readable at a glance.
 *
 * `accessibilityState.selected` is set (not `checked`) so assistive tech and UI automation can
 * both see the state, matching how the rest of @amana/ui exposes controls.
 */
export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
  tone = 'accent',
  style,
}: Props) {
  const theme = useTheme();
  const active = tone === 'debit' ? theme.colors.debit : theme.colors.accent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.colors.accentDim : theme.colors.bg.surface,
          borderColor: selected ? active : theme.colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[theme.type.bodyStrong, { color: selected ? active : theme.colors.text.secondary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
