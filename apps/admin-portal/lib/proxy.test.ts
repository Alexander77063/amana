import { describe, expect, it, vi } from 'vitest';
import { proxyToBackend } from './proxy';

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  ) as unknown as typeof fetch;
}

describe('proxyToBackend', () => {
  it('forwards method, path, query, cookie and body to the backend origin', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const fetchImpl = fakeFetch((url, init) => {
      seen.url = url;
      seen.init = init;
      return Response.json({ ok: true }, { status: 200 });
    });
    const req = new Request('https://admin.amana-ng.com/admin/iam/admins?x=1', {
      method: 'POST',
      headers: { cookie: 'amana_admin_session=abc', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@amana-ng.com' }),
    });
    const res = await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(res.status).toBe(200);
    expect(seen.url).toBe('http://localhost:3000/admin/iam/admins?x=1');
    expect(seen.init?.method).toBe('POST');
    const headers = new Headers(seen.init?.headers);
    expect(headers.get('cookie')).toBe('amana_admin_session=abc');
    expect(headers.get('content-type')).toBe('application/json');
    expect(await new Response(seen.init?.body as BodyInit).text()).toContain('a@amana-ng.com');
  });

  it('passes a 302 with Set-Cookie through untouched — the OAuth callback depends on it', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://admin.amana-ng.com',
            'set-cookie': 'amana_admin_session=tok; Path=/; HttpOnly; Secure; SameSite=Lax',
          },
        }),
    );
    const req = new Request('https://admin.amana-ng.com/admin/auth/callback?code=c&state=s');
    const res = await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://admin.amana-ng.com');
    expect(res.headers.get('set-cookie')).toContain('amana_admin_session=tok');
  });

  it('never follows redirects itself', async () => {
    const fetchImpl = fakeFetch(
      () => new Response(null, { status: 302, headers: { location: '/' } }),
    );
    const req = new Request('https://admin.amana-ng.com/admin/auth/start');
    await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    const init = (fetchImpl as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock
      .calls[0]?.[1];
    expect(init?.redirect).toBe('manual');
  });

  it('adds the browser address as x-forwarded-for and drops hop-by-hop headers', async () => {
    let headers = new Headers();
    const fetchImpl = fakeFetch((_u, init) => {
      headers = new Headers(init.headers);
      return new Response('', { status: 204 });
    });
    const req = new Request('https://admin.amana-ng.com/retailers', {
      headers: {
        'x-forwarded-for': '41.58.1.1',
        host: 'admin.amana-ng.com',
        connection: 'keep-alive',
      },
    });
    await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(headers.get('x-forwarded-for')).toBe('41.58.1.1');
    expect(headers.get('host')).toBeNull();
    expect(headers.get('connection')).toBeNull();
  });

  it('answers 502 with a stable body when the backend is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const req = new Request('https://admin.amana-ng.com/admin/me');
    const res = await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'backend_unreachable' });
  });
});
