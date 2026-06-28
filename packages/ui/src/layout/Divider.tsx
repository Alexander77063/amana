import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />;
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
});
