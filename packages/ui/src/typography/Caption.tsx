import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  children: string;
  style?: TextStyle;
};

export function Caption({ children, style }: Props) {
  const theme = useTheme();
  return (
    <Text style={[theme.type.caption, { color: theme.colors.text.muted }, style]}>
      {children}
    </Text>
  );
}
