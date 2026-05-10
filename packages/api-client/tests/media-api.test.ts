import { describe, expect, it, vi } from 'vitest';
import { MediaApi } from '../src/media-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('MediaApi.getUploadUrl', () => {
  it('POSTs /media/upload-url and returns url + key', async () => {
    const client = fakeClient(async () => ({
      uploadUrl: 'https://s3.example.com/put',
      key: 'media/txn/photo.jpg',
    }));
    const api = new MediaApi(client);
    const r = await api.getUploadUrl('txn-1', 'image/jpeg');
    expect(r.uploadUrl).toBe('https://s3.example.com/put');
    expect(r.key).toBe('media/txn/photo.jpg');
    expect(client.request).toHaveBeenCalledWith('/media/upload-url', {
      method: 'POST',
      jsonBody: { transactionId: 'txn-1', contentType: 'image/jpeg' },
    });
  });
});

describe('MediaApi.attachMedia', () => {
  it('PATCHes /transactions/:id/media', async () => {
    const client = fakeClient(async () => ({ ok: true }));
    const api = new MediaApi(client);
    await api.attachMedia('txn-1', 'media/txn/photo.jpg');
    expect(client.request).toHaveBeenCalledWith('/transactions/txn-1/media', {
      method: 'PATCH',
      jsonBody: { mediaKey: 'media/txn/photo.jpg' },
    });
  });
});
