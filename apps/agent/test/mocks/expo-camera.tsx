import { createElement } from 'react';

/**
 * `expo-camera` stand-in, aliased in `vitest.config.ts` alongside the `react-native` and
 * `@react-navigation/native` mocks. A module alias rather than a `vi.mock` factory: the factory
 * form needs `await import('react')` inside it to dodge the hoisting TDZ, and a dynamic import is
 * a TS1323 under this app's `expo/tsconfig.base` module setting — so `typecheck` would go red.
 *
 * `CameraView` forwards its props onto a named host element so a test can find it by type and fire
 * `onBarcodeScanned` itself. That the prop is `undefined` while a scan is in flight is real
 * behaviour under test, so nothing here papers over it.
 */
type AnyProps = Record<string, unknown>;

export function CameraView(props: AnyProps): JSX.Element {
  return createElement('CameraView', props);
}

/** Permission is granted by default; the ungranted branch is a separate, explicit render path. */
export function useCameraPermissions(): [{ granted: boolean }, () => void] {
  return [{ granted: true }, () => {}];
}
