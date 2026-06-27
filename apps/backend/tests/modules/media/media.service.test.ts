import { describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/put?sig=1'),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mediaService } from '../../../src/modules/media/media.service';

describe('mediaService.getUploadUrl', () => {
  it('returns the presigned URL and a jpg key for image/jpeg', async () => {
    const r = await mediaService.getUploadUrl('txn-123', 'image/jpeg');
    expect(r.uploadUrl).toBe('https://signed.example/put?sig=1');
    expect(r.key).toMatch(/^media\/txn-123\/\d+\.jpg$/);
  });

  it('uses a png extension for image/png', async () => {
    const r = await mediaService.getUploadUrl('txn-9', 'image/png');
    expect(r.key).toMatch(/^media\/txn-9\/\d+\.png$/);
  });

  it('namespaces the key under the transaction id', async () => {
    const r = await mediaService.getUploadUrl('abc-def', 'image/jpeg');
    expect(r.key.startsWith('media/abc-def/')).toBe(true);
  });

  it('presigns with a 15-minute expiry', async () => {
    await mediaService.getUploadUrl('t', 'image/jpeg');
    const lastCall = vi.mocked(getSignedUrl).mock.calls.at(-1);
    expect(lastCall?.[2]).toEqual({ expiresIn: 900 });
  });
});
