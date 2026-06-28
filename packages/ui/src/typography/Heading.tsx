import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  size?: 'lg' | 'md';
  children: string;
  style?: TextStyle;
  /** Headings announce as headers by default; pass 'text' to opt out. */
  accessibilityRole?: 'header' | 'text';
};

export function Heading({ size = 'lg', children, style, accessibilityRole = 'header' }: Props) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole={accessibilityRole}
      style={[theme.type.heading[size], { color: theme.colors.text.primary }, style]}
    >
      {children}
    </Text>
  );
}
