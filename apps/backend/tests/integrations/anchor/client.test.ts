import { describe, expect, it, vi } from 'vitest';
import { AnchorClient, AnchorHttpError } from '../../../src/integrations/anchor/client';

describe('AnchorClient', () => {
  it('GET passes auth header and parses JSON', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy });
    const result = await c.get<{ ok: boolean }>('/health');
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.x/health');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('POST serialises body and includes idempotency-key header when provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'tx-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy });
    const result = await c.post<{ id: string }>(
      '/transfers',
      { amount: 100 },
      { idempotencyKey: 'idem-abc' },
    );
    expect(result.id).toBe('tx-1');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-abc');
    expect(init.body).toBe(JSON.stringify({ amount: 100 }));
  });

  it('throws AnchorHttpError on non-2xx with status + body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy });
    await expect(c.get('/whatever')).rejects.toBeInstanceOf(AnchorHttpError);
    try {
      await c.get('/whatever');
    } catch (e) {
      const err = e as AnchorHttpError;
      expect(err.status).toBe(401);
      expect(err.body).toEqual({ error: 'unauthorized' });
    }
  });

  it('serialises bigint amount fields as JSON strings', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    const c = new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy });
    await c.post('/x', { amountKobo: 100000n });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain('"amountKobo":"100000"');
  });
});
