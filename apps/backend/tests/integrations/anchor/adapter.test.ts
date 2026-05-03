import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient, AnchorHttpError } from '../../../src/integrations/anchor/client';
import { CircuitOpenError } from '../../../src/lib/circuit-breaker';
import { testDb, truncateAll } from '../../helpers/test-db';

function buildClientWith(fetchImpl: typeof fetch): AnchorClient {
  return new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl });
}

describe('AnchorAdapter', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('happy path: returns parsed result and caches response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 't-1', status: 'COMPLETED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new AnchorAdapter({ db: testDb, client: buildClientWith(fetchSpy) });
    const out = await adapter.execIdempotent('anchor.transfer', 'idem-1', () =>
      adapter.client.post('/transfers', { amount: 100 }, { idempotencyKey: 'idem-1' }),
    );
    expect(out).toEqual({ id: 't-1', status: 'COMPLETED' });
    const cached = await testDb.execute<{ key: string }>(
      sql`SELECT key FROM idempotency_keys WHERE key = 'idem-1'`,
    );
    expect(cached).toHaveLength(1);
  });

  it('idempotent replay: short-circuits to cached response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 't-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new AnchorAdapter({ db: testDb, client: buildClientWith(fetchSpy) });
    await adapter.execIdempotent('anchor.transfer', 'idem-2', () =>
      adapter.client.post('/transfers', {}, { idempotencyKey: 'idem-2' }),
    );
    const second = await adapter.execIdempotent('anchor.transfer', 'idem-2', () => {
      throw new Error('should not be called');
    });
    expect(second).toEqual({ id: 't-1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx with exponential backoff (no real timers)', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"e":"x"}', { status: 503, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response('{"e":"x"}', { status: 502, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response('{"id":"ok"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: buildClientWith(fetchSpy),
      retryDelaysMs: [1, 1, 1, 1, 1, 1],
    });
    const out = await adapter.execIdempotent('anchor.transfer', 'idem-3', () =>
      adapter.client.post('/transfers', {}, { idempotencyKey: 'idem-3' }),
    );
    expect(out).toEqual({ id: 'ok' });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx (client error)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"e":"unauthorized"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: buildClientWith(fetchSpy),
      retryDelaysMs: [1, 1, 1],
    });
    await expect(
      adapter.execIdempotent('anchor.transfer', 'idem-4', () =>
        adapter.client.post('/transfers', {}, { idempotencyKey: 'idem-4' }),
      ),
    ).rejects.toBeInstanceOf(AnchorHttpError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after sustained failures', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"e":"down"}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: buildClientWith(fetchSpy),
      retryDelaysMs: [1, 1, 1, 1, 1, 1],
      circuitConfig: { failureRateThreshold: 0.5, windowMs: 60_000, openMs: 30_000, minSamples: 2 },
    });
    for (let i = 0; i < 2; i++) {
      await adapter
        .execIdempotent('anchor.transfer', `key-${i}`, () =>
          adapter.client.post('/transfers', {}, { idempotencyKey: `key-${i}` }),
        )
        .catch(() => undefined);
    }
    await expect(
      adapter.execIdempotent('anchor.transfer', 'after-open', () =>
        adapter.client.post('/transfers', {}, { idempotencyKey: 'after-open' }),
      ),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
