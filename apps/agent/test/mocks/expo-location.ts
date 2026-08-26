/**
 * `expo-location` stand-in, aliased in `vitest.config.ts` alongside the `react-native`,
 * `@react-navigation/native` and `expo-camera` mocks.
 *
 * A module alias rather than a `vi.mock` factory, for the same reason `expo-camera` is one: the
 * mocks that back this harness live in one place and are wired one way, and a second mechanism for
 * the same job is a second thing to remember. The real module cannot be imported here at all —
 * `expo-modules-core` reaches for `globalThis.expo.NativeModule` at import time and throws under
 * `environment: 'node'`, so ConfirmScreen is unloadable without this.
 *
 * Permission is granted and a fixed position returned. Nothing here papers over the screen's own
 * behaviour: GPS capture is behind a Switch that starts off, so a test only reaches these if it
 * deliberately turns it on.
 */
export const Accuracy = { Balanced: 3 } as const;

export async function requestForegroundPermissionsAsync(): Promise<{ status: string }> {
  return { status: 'granted' };
}

export async function getCurrentPositionAsync(): Promise<{
  coords: { latitude: number; longitude: number };
}> {
  return { coords: { latitude: 6.5244, longitude: 3.3792 } };
}
