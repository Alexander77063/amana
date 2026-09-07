import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ApiError, api, request } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fetch-shaped so `mock.calls[0]` is a two-element tuple TypeScript can index. */
const fetchMock = (impl: () => Response) =>
  vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => impl());

describe('request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses relative paths with same-origin credentials', async () => {
    const f = fetchMock(() => json({ id: '1' }));
    vi.stubGlobal('fetch', f);
    await request('/admin/me');
    expect(f).toHaveBeenCalledWith(
      '/admin/me',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('throws ApiError carrying the backend code and detail', async () => {
    vi.stubGlobal(
      'fetch',
      fetchMock(() => json({ error: 'conflict', detail: 'approval_not_pending' }, 409)),
    );
    await expect(request('/x')).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      detail: 'approval_not_pending',
    } satisfies Partial<ApiError>);
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal(
      'fetch',
      fetchMock(() => new Response(null, { status: 204 })),
    );
    expect(await request('/x', { method: 'POST' })).toBeUndefined();
  });

  it('posts JSON bodies', async () => {
    const f = fetchMock(() => json({ approvalId: 'a', status: 'pending' }, 202));
    vi.stubGlobal('fetch', f);
    await api.iam.grant('u1', 'ops', 'why');
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ role: 'ops', reason: 'why' });
  });

  it('builds the vendor search query only from present params', async () => {
    const f = fetchMock(() => json({ vendors: [] }));
    vi.stubGlobal('fetch', f);
    await api.vendors.search(undefined, 'tyres');
    expect(f.mock.calls[0]?.[0]).toBe('/vendors-admin/vendors?q=tyres');
  });
});
