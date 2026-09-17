import { PRINCIPAL_TERMS_VERSION } from '@amana/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { auth: { verifyOtp: vi.fn(), requestOtp: vi.fn() } },
}));
vi.mock('../lib/secure-token-store', () => ({
  secureTokenStore: { read: vi.fn(), write: vi.fn().mockResolvedValue(undefined), clear: vi.fn() },
}));
// The store reaches push registration on logout, which pulls in expo-notifications' native module
// and cannot load under vitest. Stubbed so this file can exercise the store at all.
vi.mock('./push.store', () => ({
  usePushStore: { getState: () => ({ unregister: vi.fn() }) },
}));

import { api } from '../lib/api';
import { useAuthStore } from './auth.store';

const loginResponse = {
  accessToken: 'A',
  refreshToken: 'R',
  accessExpiresAt: '',
  refreshExpiresAt: '',
  user: { id: 'u1', role: 'principal', phone: '+2348012345678', kycTier: '2' },
};

describe('principal auth store — signup terms acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ pendingPhone: '+2348012345678', errorCode: null, busy: false });
  });

  /**
   * The backend has required `acceptedTermsVersion` on any call that CREATES a user since
   * 2026-08-27 (`auth.ts`, commit b411bb7). No client ever sent it, so every new signup was
   * refused with `terms_not_accepted` — invisible to unit tests because each side was internally
   * consistent, and invisible in daily use because existing users log in on a different branch.
   */
  it('sends the principal terms version so the server can record acceptance', async () => {
    vi.mocked(api.auth.verifyOtp).mockResolvedValue(loginResponse as never);

    await useAuthStore
      .getState()
      .verifyOtp({ code: '123456', nin: '22226703166', bvn: '33337814277' });

    expect(api.auth.verifyOtp).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedTermsVersion: PRINCIPAL_TERMS_VERSION }),
    );
  });

  // The version must come from the shared constant, never a literal retyped in the app: that is
  // precisely how the two sides drifted apart in the first place.
  it('sends a non-empty version that matches the shared constant exactly', async () => {
    vi.mocked(api.auth.verifyOtp).mockResolvedValue(loginResponse as never);

    await useAuthStore.getState().verifyOtp({ code: '123456' });

    const sent = vi.mocked(api.auth.verifyOtp).mock.calls[0]?.[0] as {
      acceptedTermsVersion?: string;
    };
    expect(sent.acceptedTermsVersion).toBeTruthy();
    expect(sent.acceptedTermsVersion).toBe(PRINCIPAL_TERMS_VERSION);
  });
});
