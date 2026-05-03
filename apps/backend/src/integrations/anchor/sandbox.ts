import { env } from '../../env';

export interface AnchorConfig {
  baseUrl: string;
  apiKey: string | undefined;
}

export const anchorConfig: AnchorConfig = {
  baseUrl: env.ANCHOR_API_BASE_URL,
  apiKey: env.ANCHOR_API_KEY,
};
