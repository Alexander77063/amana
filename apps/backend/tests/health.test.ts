import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server';

describe('GET /health', () => {
  it('returns status ok and a version string', async () => {
    const app = createServer();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('emits an x-request-id header', async () => {
    const app = createServer();
    const res = await app.request('/health');
    expect(res.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
