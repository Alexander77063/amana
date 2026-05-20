import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  size?: 'lg' | 'md';
  children: string;
  style?: TextStyle;
};

export function Heading({ size = 'lg', children, style }: Props) {
  const theme = useTheme();
  return (
    <Text style={[theme.type.heading[size], { color: theme.colors.text.primary }, style]}>
      {children}
    </Text>
  );
}
