import {
  TextInput as RNTextInput,
  StyleSheet,
  Text,
  type TextInputProps,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = TextInputProps & {
  label?: string;
  error?: string;
};

export function TextInput({ label, error, style, ...rest }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text style={[theme.type.label, { color: theme.colors.text.secondary, marginBottom: 6 }]}>
          {label}
        </Text>
      ) : null}
      <RNTextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.text.muted}
        style={[
          theme.type.body,
          {
            color: theme.colors.text.primary,
            backgroundColor: theme.colors.bg.surface,
            borderWidth: 1,
            borderColor: error ? theme.colors.debit : theme.colors.border,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            height: 48,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[theme.type.caption, { color: theme.colors.debit, marginTop: 4 }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 12 },
});
