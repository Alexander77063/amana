import { type ReactNode, useEffect } from 'react';

/** Runs the focus callback once on mount (and re-runs if it changes). */
export function useFocusEffect(callback: () => undefined | (() => void)): void {
  useEffect(() => callback(), [callback]);
}

export const useNavigation = () => ({
  navigate: () => {},
  goBack: () => {},
  setOptions: () => {},
  addListener: () => () => {},
});

export const useRoute = () => ({ params: {} });
export const useIsFocused = () => true;
export const NavigationContainer = ({ children }: { children: ReactNode }) => children;
export const useTheme = () => ({ dark: false, colors: {} });
