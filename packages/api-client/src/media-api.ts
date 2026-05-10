import type { AuthedClient } from './household-api';

export class MediaApi {
  constructor(private readonly client: AuthedClient) {}

  getUploadUrl(
    transactionId: string,
    contentType: 'image/jpeg' | 'image/png',
  ): Promise<{ uploadUrl: string; key: string }> {
    return this.client.request<{ uploadUrl: string; key: string }>('/media/upload-url', {
      method: 'POST',
      jsonBody: { transactionId, contentType },
    });
  }

  async attachMedia(transactionId: string, mediaKey: string): Promise<void> {
    await this.client.request<{ ok: boolean }>(
      `/transactions/${encodeURIComponent(transactionId)}/media`,
      { method: 'PATCH', jsonBody: { mediaKey } },
    );
  }
}
