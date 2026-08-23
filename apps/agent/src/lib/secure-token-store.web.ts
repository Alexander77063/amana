import type { StoredAuth, TokenStore } from '@amana/api-client';

// Web twin of secure-token-store.ts, resolved by Metro only for Platform.OS === 'web'.
// The native file is untouched, and nothing that imports `secureTokenStore` changes.
//
// `expo-secure-store` has no web implementation — its ExpoSecureStore.web.js is literally
// `export default {}` — so the native module's methods are absent on web and every call
// throws. The web build exists for the browser-based demo harness, not for shipping, so
// this deliberately trades the Keychain/Keystore for localStorage.
//
// SECURITY: localStorage is readable by any script on the origin. This is acceptable ONLY
// because the web target is a demo/dev surface. If a real retailer or buyer web app ever
// ships (SP4b portal, SP5b buyer web), do NOT reuse this: move to an httpOnly cookie
// session, which JavaScript cannot read at all.

const KEY = 'amana.agent.auth.v1';

/** localStorage throws in private-mode/blocked-cookie contexts; never let that crash boot. */
function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__amana_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const memory = new Map<string, string>();

const get = (k: string): string | null => safeStorage()?.getItem(k) ?? memory.get(k) ?? null;
const set = (k: string, v: string): void => {
  const s = safeStorage();
  if (s) s.setItem(k, v);
  else memory.set(k, v);
};
const del = (k: string): void => {
  safeStorage()?.removeItem(k);
  memory.delete(k);
};

export const secureTokenStore: TokenStore = {
  async read() {
    const raw = get(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      // Storage was corrupted somehow; treat as logged out.
      del(KEY);
      return null;
    }
  },
  async write(auth) {
    set(KEY, JSON.stringify(auth));
  },
  async clear() {
    del(KEY);
  },
};
