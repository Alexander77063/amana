import { createContext, useContext } from 'react';
import { darkColors, typeScale } from './tokens';
import type { Colors, TypeScale } from './tokens';

export type Theme = {
  colors: Colors;
  type: TypeScale;
  isDark: boolean;
};

export const ThemeContext = createContext<Theme>({
  colors: darkColors,
  type: typeScale,
  isDark: true,
});

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
