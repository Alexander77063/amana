'use client';

import {
  AmanaApiClient,
  type RetailerSession,
  type StoredAuth,
  type TokenStore,
} from '@amana/api-client';

const KEY = 'amana.retailer.auth';

/**
 * Where the portal keeps its session.
 *
 * `localStorage` rather than a cookie because the backend is a separate origin authenticated by
 * bearer token — there is no same-site cookie to send, and the API client already owns refresh.
 * Every accessor is wrapped: a browser with site data blocked throws on access rather than
 * returning null, and a portal that cannot read a token should show the sign-in screen, not a
 * stack trace.
 */
const browserTokenStore: TokenStore = {
  async read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as StoredAuth) : null;
    } catch {
      return null;
    }
  },
  async write(auth) {
    try {
      localStorage.setItem(KEY, JSON.stringify(auth));
    } catch {
      // A session that cannot be persisted still works for this tab; losing it on reload is
      // better than refusing to sign in at all.
    }
  },
  async clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

export const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

export const api = new AmanaApiClient({
  baseUrl: API_BASE,
  tokenStore: browserTokenStore,
});

export async function signOut(): Promise<void> {
  await browserTokenStore.clear();
}

export async function hasSession(): Promise<boolean> {
  return (await browserTokenStore.read()) !== null;
}

/**
 * Persist what retailer sign-in returned, in the `{ tokens, user }` shape the API client's
 * refresh path expects. `/auth/refresh` is unauthenticated against the access token by design, so
 * it has to be told which user it is refreshing for — which is why `userId` is carried here at all.
 */
export async function storeSession(input: RetailerSession, phone: string): Promise<void> {
  await browserTokenStore.write({
    tokens: {
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessExpiresAt: input.accessExpiresAt,
      refreshExpiresAt: input.refreshExpiresAt,
    },
    user: { id: input.userId, role: 'retailer', phone, kycTier: '1' },
  });
}

/**
 * Kobo (as a string, because totals outgrow Number) to naira for display.
 *
 * Mirrors `formatNaira` in @amana/ui. Duplicated for the same reason the tokens are — a Next app
 * cannot import React Native source — and kept byte-identical in output so the same amount reads
 * the same in the portal and in the apps.
 */
export function formatNaira(koboStr: string | null | undefined): string {
  if (koboStr === null || koboStr === undefined) return '—';
  const kobo = BigInt(koboStr);
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  const naira = abs / 100n;
  const rest = abs % 100n;
  const grouped = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}₦${grouped}.${rest.toString().padStart(2, '0')}`;
}

/** Turn an ApiError (or anything else) into something a retailer can act on. */
export function errorMessage(e: unknown): string {
  const code = (e as { body?: { error?: string } } | undefined)?.body?.error;
  switch (code) {
    case 'invalid_code':
      return 'That code is not right. Check it and try again.';
    case 'too_many_attempts':
      return 'Too many attempts. Wait a few minutes and request a new code.';
    case 'nin_required':
      return 'First sign-in needs your NIN. Enter it, then request a new code.';
    case 'no_retailer_for_phone':
      return 'No business is registered to this number. Contact Amana to get set up.';
    case 'rate_limited':
      return 'Too many requests. Try again shortly.';
    case 'forbidden':
      return 'Your business is not approved for this yet.';
    case 'kyb_incomplete':
      return 'Finish business verification before taking payments.';
    default:
      return (e as Error | undefined)?.message ?? 'Something went wrong.';
  }
}
