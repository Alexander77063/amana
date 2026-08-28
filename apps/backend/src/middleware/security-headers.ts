import type { MiddlewareHandler } from 'hono';

/**
 * Two years, subdomains included, preload-eligible.
 *
 * Not configurable, deliberately. This is item 1 of the vendor-code pre-distribution gate
 * (docs/runbook/go-live-checklist.md §6) and the value is load-bearing rather than a preference:
 * the HSTS preload list refuses a `max-age` under one year and refuses a policy without
 * `includeSubDomains` or `preload`. An env knob here would let a deploy silently fall out of
 * preload eligibility long after `amana-ng.com` was accepted — and de-listing propagates on
 * browser-release timescales, so that is not a mistake you take back quickly.
 *
 * Exported so a test asserts the served value against the same constant the middleware serves.
 */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';

const HEADER = 'Strict-Transport-Security';

/**
 * Serve HSTS on **every** response.
 *
 * Why the header is written after `await next()` rather than before: `errorHandler` answers a
 * thrown error by building a brand-new `Response`, and a 404 for an unregistered route never
 * reaches a handler at all. Staging the header on the way in gets it dropped in exactly those
 * cases — the ones a mistyped sticker actually produces. Writing it onto whatever response came
 * back covers the success path, the 404, the 401 and the 500 identically.
 *
 * Why it is sent unconditionally rather than only when the request arrived over TLS: RFC 6797 §7.2
 * requires a user agent to **ignore** an HSTS header received over a non-secure transport, so the
 * plaintext case is inert rather than harmful. Gating on `x-forwarded-proto` would buy nothing and
 * introduce a way to fail *silently closed* — one proxy misconfiguration and the header quietly
 * stops being served, which is precisely the failure this control cannot afford, because nothing
 * about it is visible until an attacker uses it.
 *
 * `fly.toml`'s `force_https = true` is not a substitute: that is a 301 that travels in cleartext,
 * so an on-path attacker on market Wi-Fi rewrites it before the browser ever sees it.
 */
export const securityHeaders = (): MiddlewareHandler => async (c, next) => {
  await next();
  c.res.headers.set(HEADER, HSTS_VALUE);
};
