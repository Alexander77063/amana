import { createHash } from 'node:crypto';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { escapeHtml } from '../lib/html';
import { parseParams } from '../lib/validate';
import { vendorsRepo } from '../modules/vendors/vendors.repo';

/**
 * `AMNV-` plus two 5-symbol groups. What this validates is the code's STRUCTURE — the prefix, the
 * two dashes, exactly five symbols per group. None of that can be repaired by normalization, so a
 * violation is genuinely malformed input and 400s here without ever reaching Postgres.
 *
 * The character class is the full alphanumeric set rather than the minted Crockford alphabet, for
 * the reasons written out at `VendorCodeParams` in `routes/vendors.ts`: `I`/`L`/`O` have to reach
 * `findByPublicCode` so `normalizeCrockford` can fold them, and `U` has to reach it so it misses
 * as a clean 404 rather than being called malformed. `.trim()` here rather than in the fold —
 * padding is a format defect, like a missing dash, and `findByPublicCode` does not trim.
 */
const CodeParams = z.object({
  code: z
    .string()
    .trim()
    .regex(/^AMNV-[0-9A-Za-z]{5}-[0-9A-Za-z]{5}$/i, 'invalid_code'),
});

/**
 * The page's entire stylesheet, as one constant so it can be hashed for the CSP.
 *
 * Emitted verbatim between `<style>` and `</style>` — the hash below covers exactly this string,
 * so the two cannot drift. System fonts only: a webfont would be an external request, and the
 * whole point of this page is that it renders on a cheap phone on a bad network with nothing to
 * fetch. Colours are the @amana/ui brand tokens, restated rather than imported because this
 * package cannot depend on a React Native library.
 */
const STYLE_CSS = `
  :root { color-scheme: light dark;
    --bg:#F5F0E8; --surface:#FFFFFF; --ink:#0D1B2A; --muted:#5F6B78;
    --line:#E3DDD2; --gold:#C9A227; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0D1B2A; --surface:#152535; --ink:#F5F0E8; --muted:#8BA3B8;
      --line:#1C3147; --gold:#C9A227; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
    background:var(--bg); color:var(--ink);
    font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    -webkit-text-size-adjust:100%; }
  main { width:100%; max-width:26rem; background:var(--surface); border:1px solid var(--line);
    border-radius:16px; padding:32px 24px; text-align:center; }
  .mark { font-size:.75rem; letter-spacing:.18em; text-transform:uppercase; color:var(--gold);
    font-weight:700; margin:0 0 20px; }
  h1 { font-size:1.5rem; line-height:1.25; margin:0 0 4px; overflow-wrap:anywhere; }
  p { margin:0; }
  .muted { color:var(--muted); font-size:.9rem; }
  .badge { display:inline-block; margin:12px 0 0; padding:4px 10px; border-radius:999px;
    border:1px solid var(--line); color:var(--muted); font-size:.8rem; }
  .acct { margin:20px 0; padding:12px 0; border-top:1px solid var(--line);
    border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums;
    letter-spacing:.06em; }
  .cta { margin-top:20px; font-size:.95rem; }
`;

/**
 * `style-src` is pinned to the hash of the stylesheet we actually serve, not `'unsafe-inline'`.
 * An inline allowance re-opens the injection route the escaper exists to close, and costs nothing
 * to avoid when the CSS is a compile-time constant.
 *
 * `base-uri`, `form-action` and `frame-ancestors` are listed explicitly because none of them falls
 * back to `default-src` — omitting them leaves a page with `default-src 'none'` still frameable
 * and still re-basable.
 */
const STYLE_HASH = `'sha256-${createHash('sha256').update(STYLE_CSS, 'utf8').digest('base64')}'`;
const CSP = [
  "default-src 'none'",
  `style-src ${STYLE_HASH}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Applied to every response this router produces, including the 400/404/410 pages.
 *
 * `no-store` rather than a short max-age: suspending a vendor is a safety control whose entire
 * purpose is to take effect immediately, and a cached page keeps advertising a live business for
 * as long as the TTL says. The database is protected by the rate limiter on `/v/*` instead — the
 * control that can say no without going stale. The page is under 2 KB, so there is nothing to
 * save by caching it.
 */
function securityHeaders(c: Context): void {
  c.header('Content-Security-Policy', CSP);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  // Redundant with `frame-ancestors` on any current browser, and still worth the 24 bytes: the
  // phones scanning shop windows in this market are not all current browsers.
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', 'no-store, max-age=0');
}

/**
 * A self-contained page — no external scripts, stylesheets, fonts or images.
 *
 * It is opened by strangers on unknown networks, and every external reference would be both a
 * privacy leak about who scanned a given shop's code and a way for the page to break in a market
 * with poor connectivity.
 *
 * `noindex` because a crawlable set of these pages is a searchable directory of Nigerian
 * businesses and the last four digits of their bank accounts — the registry is deliberately not
 * exposed by any route, and letting a search engine rebuild it from the shop windows would give
 * that back. The code is unguessable, so the only way a crawler finds one is if someone publishes
 * it; this stops that one page from becoming an index entry.
 */
function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} · Amana</title>
<style>${STYLE_CSS}</style>
</head><body><main><p class="mark">Amana</p>${bodyHtml}</main></body></html>`;
}

/**
 * Both dead ends are HTML and both are deliberately distinguishable.
 *
 * A suspended vendor keeps its `publicCode`, so "this code was real and is now dead" is a
 * different fact from "this code never existed", and the payer standing in the shop is the person
 * who needs to know which. It leaks nothing: at 32^10 the only way to hold a well-formed code is
 * for a vendor to have given it to you.
 *
 * Neither page echoes the requested code. Escaping it would be sufficient, but not echoing it is
 * one fewer place for the next person to interpolate user input into markup by hand.
 */
const UNKNOWN_PAGE = page(
  'Unknown code',
  `<h1>That code was not recognised</h1>
       <p class="muted">Check it against the sticker, or ask the vendor for another way to pay.</p>`,
);
const GONE_PAGE = page(
  'Code inactive',
  `<h1>This code is no longer active</h1>
       <p class="muted">Please ask the vendor for another way to pay.</p>`,
);
const INVALID_PAGE = page(
  'Invalid code',
  `<h1>That is not an Amana code</h1>
       <p class="muted">An Amana code looks like AMNV-7QK21-9PZ0R.</p>`,
);

/**
 * The public face of an Amana Vendor Code. Mounted at `/v`, unauthenticated by necessity: it is
 * opened by whoever points a camera at a sticker in a shop window.
 *
 * It exists because the code is a URL. Without this page every scan by an ordinary camera app —
 * which is most of them — would land on nothing, and a dead link in a shop window attached to a
 * payments brand is worse than no code at all.
 *
 * It shows only what the shop already displays publicly: its name, and the last four digits of the
 * account on its own POS sticker. Never the full account number — a passer-by does not need it,
 * and the Amana apps get it from the authenticated endpoint instead.
 *
 * **No NIBSS name enquiry happens here, and none may be added.** Every other resolution path
 * re-confirms the name with the bank on every scan; this one deliberately does not, because an
 * unauthenticated endpoint that triggers a paid partner call is a financial denial-of-service, and
 * that call runs on the same circuit breaker as real spend — so anyone with a photographed sticker
 * could take payments down. The consequence is that `displayName` here can be stale, and that is
 * the correct trade: this page IDENTIFIES a business, it does not authorise a payment. The pay
 * path (`GET /vendors/code/:code`) re-verifies against NIBSS on every single scan.
 */
export const vendorPageRoute = new Hono()
  .use('*', async (c, next) => {
    securityHeaders(c);
    await next();
  })
  .get('/:code', async (c) => {
    const params = parseParams(c, CodeParams);
    // `parseParams` answers with a JSON validation error, which is right everywhere else and wrong
    // here: the caller is a phone camera, not a client library. Swap it for the HTML equivalent.
    if (params instanceof Response) return c.html(INVALID_PAGE, 400);

    const vendor = await vendorsRepo.findByPublicCode(db, params.code);
    if (!vendor) return c.html(UNKNOWN_PAGE, 404);

    // Field by field, never the row. `vendors` carries `claimedByPhone` — a raw MSISDN belonging
    // to the business owner — and a single spread of `vendor` into a template or a JSON dump would
    // publish it to the open internet. Destructured here so the reviewer can SEE the three fields
    // that leave, rather than having to trust that they are the only three used below.
    const { displayName, accountNumber, status } = vendor;

    // An ALLOW-list with an exhaustive `never` guard, matching `vendorCodeLookupService`. Written
    // as `status === 'suspended' ? 410 : 200` this page would stamp "Verified on Amana" on an
    // `observed` row — a vendor nobody has proven they own — and on every status added to
    // `vendorStatusEnum` later, while the in-app pay path answered 404 for the same row. A fourth
    // enum member fails to compile here until someone decides which side of the line it falls on.
    switch (status) {
      case 'claimed':
        break;
      case 'suspended':
        return c.html(GONE_PAGE, 410);
      // Only `claim()` writes `publicCode`, and it does so atomically with `status: 'claimed'`, so
      // a code on an observed row got there by hand. "No such code" is the honest answer.
      case 'observed':
        return c.html(UNKNOWN_PAGE, 404);
      default: {
        const _exhaustive: never = status;
        return c.html(UNKNOWN_PAGE, 404);
      }
    }

    const name = escapeHtml(displayName);
    const masked = escapeHtml(accountNumber.slice(-4));
    return c.html(
      page(
        displayName,
        `<h1>${name}</h1>
       <p class="badge">Verified on Amana</p>
       <p class="acct">Account ending <span aria-hidden="true">••••</span>${masked}</p>
       <p class="muted cta">Open the Amana app and scan this code to pay.</p>`,
      ),
      200,
    );
  });
