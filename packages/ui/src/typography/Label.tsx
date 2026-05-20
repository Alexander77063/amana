import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  children: string;
  style?: TextStyle;
};

export function Label({ children, style }: Props) {
  const theme = useTheme();
  return (
    <Text style={[theme.type.label, { color: theme.colors.text.secondary }, style]}>
      {children}
    </Text>
  );
}
