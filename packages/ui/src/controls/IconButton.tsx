import { type ReactNode } from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  onPress: () => void;
  children: ReactNode;
  style?: ViewStyle;
};

export function IconButton({ onPress, children, style }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          padding: 8,
          borderRadius: 8,
          backgroundColor: pressed ? theme.colors.accentDim : 'transparent',
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
