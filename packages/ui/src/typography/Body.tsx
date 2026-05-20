import { Text, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  strong?: boolean;
  children: string | string[];
  style?: TextStyle;
  muted?: boolean;
};

export function Body({ strong = false, children, style, muted = false }: Props) {
  const theme = useTheme();
  const ts = strong ? theme.type.bodyStrong : theme.type.body;
  const color = muted ? theme.colors.text.muted : theme.colors.text.primary;
  return <Text style={[ts, { color }, style]}>{children}</Text>;
}
