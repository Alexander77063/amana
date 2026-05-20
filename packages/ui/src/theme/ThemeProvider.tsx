import { type ReactNode, useEffect, useState } from 'react';
import { Appearance, View } from 'react-native';
import { ThemeContext } from './ThemeContext';
import { darkColors, lightColors, typeScale } from './tokens';

type Props = {
  children: ReactNode;
  fontsLoaded?: boolean;
};

export function ThemeProvider({ children, fontsLoaded = true }: Props) {
  const [isDark, setIsDark] = useState(
    (Appearance.getColorScheme() ?? 'light') === 'dark',
  );

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setIsDark((colorScheme ?? 'light') === 'dark');
    });
    return () => sub.remove();
  }, []);

  const colors = isDark ? darkColors : lightColors;

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg.base }} />;
  }

  return (
    <ThemeContext.Provider value={{ colors, type: typeScale, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}
