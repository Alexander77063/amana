import type { StoredAuth, TokenStore } from '@amana/api-client';
import * as SecureStore from 'expo-secure-store';

const KEY = 'amana.auth.v1';

export const secureTokenStore: TokenStore = {
  async read() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      // Storage was corrupted somehow; treat as logged out.
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
  },
  async write(auth) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(auth));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};
