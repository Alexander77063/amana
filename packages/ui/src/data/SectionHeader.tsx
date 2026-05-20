import { View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Label } from '../typography/Label';

type Props = {
  title: string;
};

export function SectionHeader({ title }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 8,
        backgroundColor: theme.colors.bg.base,
      }}
    >
      <Label>{title}</Label>
    </View>
  );
}
