import { ApiError, type StoredAuth } from '@amana/api-client';
import type { LoginResponse, User } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';
import { secureTokenStore } from '../lib/secure-token-store';

export type AuthStatus = 'booting' | 'logged_out' | 'logged_in';

export type AuthState = {
  status: AuthStatus;
  user: User | null;
  /** Phone we're verifying against — set by requestOtp, used by verifyOtp. */
  pendingPhone: string | null;
  /** Most recent error code (e.g. 'wrong_code', 'too_many_attempts'). null when clean. */
  errorCode: string | null;
  /** True while a network call is inflight. */
  busy: boolean;

  bootstrap(): Promise<void>;
  requestOtp(phone: string): Promise<void>;
  verifyOtp(input: { code: string; nin?: string; bvn?: string }): Promise<void>;
  logout(): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'booting',
  user: null,
  pendingPhone: null,
  errorCode: null,
  busy: false,

  async bootstrap() {
    const stored = await secureTokenStore.read();
    if (!stored) {
      set({ status: 'logged_out', user: null });
      return;
    }
    // Validate the persisted session. If `/me` 401s and refresh fails, we clear locally.
    try {
      const me = await api.request<User>('/me');
      set({ status: 'logged_in', user: me });
    } catch {
      await secureTokenStore.clear();
      set({ status: 'logged_out', user: null });
    }
  },

  async requestOtp(phone) {
    set({ busy: true, errorCode: null });
    try {
      await api.auth.requestOtp({ phone, purpose: 'login' });
      set({ pendingPhone: phone, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async verifyOtp({ code, nin, bvn }) {
    const phone = get().pendingPhone;
    if (!phone) throw new Error('verifyOtp called without pendingPhone — call requestOtp first');
    set({ busy: true, errorCode: null });
    try {
      const r: LoginResponse = await api.auth.verifyOtp({ phone, code, nin, bvn });
      const stored: StoredAuth = {
        tokens: {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          accessExpiresAt: r.accessExpiresAt,
          refreshExpiresAt: r.refreshExpiresAt,
        },
        user: r.user,
      };
      await secureTokenStore.write(stored);
      set({ status: 'logged_in', user: r.user, pendingPhone: null, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async logout() {
    set({ busy: true });
    try {
      try {
        const stored = await secureTokenStore.read();
        if (stored) await api.auth.logout(stored.tokens.accessToken);
      } catch {
        // Best-effort — even if revoke fails, we clear locally.
      }
      await secureTokenStore.clear();
      set({ status: 'logged_out', user: null, pendingPhone: null, busy: false, errorCode: null });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },
}));
