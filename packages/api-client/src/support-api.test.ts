import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { SupportApi } from './support-api';

describe('SupportApi', () => {
  it('posts the chosen number to the verification it answers', async () => {
    const request = vi.fn().mockResolvedValue({ outcome: 'verified' });
    const api = new SupportApi({ request } as unknown as ConstructorParameters<
      typeof SupportApi
    >[0]);

    const result = await api.respond('ver-1', 47);

    expect(request).toHaveBeenCalledWith('/support/verifications/ver-1/respond', {
      method: 'POST',
      jsonBody: { chosenNumber: 47 },
    });
    expect(result.outcome).toBe('verified');
  });

  it('surfaces a denial as an outcome rather than an error', async () => {
    const request = vi.fn().mockResolvedValue({ outcome: 'denied' });
    const api = new SupportApi({ request } as unknown as ConstructorParameters<
      typeof SupportApi
    >[0]);

    // A wrong tap is a normal answer, not a failure — the app must show "that did not verify",
    // not a crash dialog.
    await expect(api.respond('ver-2', 11)).resolves.toEqual({ outcome: 'denied' });
  });

  it('lets a transport error propagate as ApiError', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('boom', 500, 'server_error', null));
    const api = new SupportApi({ request } as unknown as ConstructorParameters<
      typeof SupportApi
    >[0]);

    await expect(api.respond('ver-3', 47)).rejects.toBeInstanceOf(ApiError);
  });
});
