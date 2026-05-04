// Anchor BaaS adapter surface.

export { anchorConfig, type AnchorConfig } from './sandbox';
export { AnchorClient, AnchorHttpError, type AnchorClientConfig } from './client';
export { AnchorAdapter, type AdapterConfig } from './adapter';
export {
  formatAgentNarration,
  formatPrincipalNarration,
  hashAgentReference,
  selectNarration,
  type NarrationInput,
} from './narration';
export { parseAndVerifyWebhook, WebhookSignatureError } from './webhook';
export type * from './types';

import { db } from '../../db/client';
import { env as _env } from '../../env';
import { AnchorAdapter as _AnchorAdapter } from './adapter';
import { AnchorClient as _AnchorClient } from './client';

export const anchorAdapterSingleton = new _AnchorAdapter({
  db,
  client: new _AnchorClient({
    baseUrl: _env.ANCHOR_API_BASE_URL,
    apiKey: _env.ANCHOR_API_KEY ?? '',
  }),
});
