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
