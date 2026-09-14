/**
 * Same-origin proxy for the backend's staff routes.
 *
 * The API sets the staff session as a host-only `HttpOnly; Secure; SameSite=Lax` cookie with no
 * `domain`, so it belongs to whichever host the browser got the `Set-Cookie` from. For the
 * portal's own fetches to carry it, the portal host must BE that host — hence `/admin/*`,
 * `/vendors-admin/*` and `/retailers/*` are answered here and forwarded, and the browser never
 * talks to `api.amana-ng.com` directly.
 *
 * Written as an explicit handler rather than `next.config` rewrites because the one response that
 * matters most — the OAuth callback, a 302 that also carries the Set-Cookie — must pass through
 * byte-for-byte, and this function is the one place that guarantees it (and is tested for it).
 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'content-length',
]);

export type ProxyOptions = { backendOrigin: string; fetchImpl?: typeof fetch };

export async function proxyToBackend(request: Request, opts: ProxyOptions): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, opts.backendOrigin);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Fly stamps `fly-client-ip` with the portal machine, so the API's per-IP limiter on
  // /admin/auth/* sees one address for all staff. That is accepted (a handful of people, 60 per
  // 15 minutes); the browser's address travels in x-forwarded-for for logs.
  if (!headers.has('x-forwarded-for')) {
    const ip = request.headers.get('x-real-ip');
    if (ip) headers.set('x-forwarded-for', ip);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetchImpl(target.toString(), {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      // The backend's redirects are for the BROWSER (Google, then back to the portal). Following
      // them here would swallow the Set-Cookie on the callback and land the proxy on a page.
      redirect: 'manual',
    });
  } catch {
    return Response.json({ error: 'backend_unreachable' }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.append(key, value);
  });
  // `Headers.forEach` folds multiple Set-Cookie values; use getSetCookie where the runtime has it.
  const cookies = (
    upstream.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  if (cookies && cookies.length > 0) {
    out.delete('set-cookie');
    for (const c of cookies) out.append('set-cookie', c);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
