import type { IssuedTokens, User } from '@amana/types';

/** Persistent + revocable storage for the auth state. Implementation is platform-specific. */
export interface TokenStore {
  read(): Promise<StoredAuth | null>;
  write(auth: StoredAuth): Promise<void>;
  clear(): Promise<void>;
}

/**
 * What we persist across app restarts. The `userId+role` shape is required
 * to call `/auth/refresh` (which is unauthenticated against the access JWT
 * by design — see Sub-plan 6a, T16).
 */
export type StoredAuth = {
  tokens: IssuedTokens;
  user: User;
};

/** In-memory impl — useful for tests + the auto-refresh single-flight cache. */
export function createInMemoryTokenStore(): TokenStore {
  let state: StoredAuth | null = null;
  return {
    async read() {
      return state;
    },
    async write(auth) {
      state = auth;
    },
    async clear() {
      state = null;
    },
  };
}
