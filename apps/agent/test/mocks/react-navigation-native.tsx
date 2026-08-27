import { type ReactNode, useEffect } from 'react';

/**
 * Registered focus callbacks, so a test can re-fire focus.
 *
 * A native stack keeps a screen MOUNTED behind the one pushed on top of it, so coming back is a
 * focus event and not a remount. Any reset a screen does on focus is therefore untestable if the
 * harness can only ever fire focus once, at mount — which is exactly the bug class this exists to
 * cover (a spinner left running by a screen the payer navigated away from).
 */
const focusCallbacks = new Set<() => unknown>();

/** Runs the focus callback on mount, and again on every `fireFocus()`. */
export function useFocusEffect(callback: () => undefined | (() => void)): void {
  useEffect(() => {
    focusCallbacks.add(callback);
    const cleanup = callback();
    return () => {
      focusCallbacks.delete(callback);
      if (typeof cleanup === 'function') cleanup();
    };
  }, [callback]);
}

/** Test hook: re-focus every mounted screen, as returning from a pushed screen does. */
export function fireFocus(): void {
  for (const cb of [...focusCallbacks]) cb();
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
