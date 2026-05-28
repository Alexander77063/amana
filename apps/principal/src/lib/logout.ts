import type { AmanaApiClient, TokenStore } from '@amana/api-client';

export async function runLogout(
  api: AmanaApiClient,
  tokenStore: TokenStore,
  unregisterPush: () => Promise<void>,
): Promise<void> {
  await unregisterPush().catch(() => {});
  const stored = await tokenStore.read();
  if (stored) await api.auth.logout(stored.tokens.accessToken).catch(() => {});
  await tokenStore.clear();
}
