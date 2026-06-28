import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  title?: string;
  headerRight?: ReactNode;
  headerLeft?: ReactNode;
  scrollable?: boolean;
  noPadding?: boolean;
  keyboardAvoiding?: boolean;
  children: ReactNode;
  style?: ViewStyle;
};

export function Screen({
  title,
  headerRight,
  headerLeft,
  scrollable = false,
  noPadding = false,
  keyboardAvoiding = false,
  children,
  style,
}: Props) {
  const theme = useTheme();

  const header =
    title || headerRight || headerLeft ? (
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <View style={styles.headerSide}>{headerLeft ?? null}</View>
        {title ? (
          <Text
            accessibilityRole="header"
            style={[theme.type.heading.lg, { color: theme.colors.text.primary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        ) : (
          <View />
        )}
        <View style={styles.headerSide}>{headerRight ?? null}</View>
      </View>
    ) : null;

  const contentStyle: ViewStyle = noPadding
    ? { flex: 1 }
    : { flex: 1, paddingHorizontal: 20, paddingBottom: 48 };

  const body = scrollable ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={noPadding ? undefined : { paddingHorizontal: 20, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[contentStyle, style]}>{children}</View>
  );

  const inner = (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.colors.bg.base }]}>
      {header}
      {body}
    </SafeAreaView>
  );

  if (keyboardAvoiding) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {inner}
      </KeyboardAvoidingView>
    );
  }

  return inner;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: {
    minWidth: 40,
    alignItems: 'center',
  },
});
