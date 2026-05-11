import { AmanaApiClient } from '@amana/api-client';
import { secureTokenStore } from './secure-token-store';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

export const api = new AmanaApiClient({
  baseUrl: BACKEND_URL,
  tokenStore: secureTokenStore,
});
