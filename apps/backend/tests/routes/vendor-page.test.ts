import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { vendors } from '../../src/db/schema';
import { env } from '../../src/env';
import { type VendorRow, vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-10T10:00:00Z');
/**
 * A minted code, in minted form. It carries both a `1` and a `0` on purpose: those are the two
 * digits `normalizeCrockford` folds `I`/`L` and `O` onto, and a code containing neither cannot
 * prove the fold survives this route's own validation.
 */
const CODE = 'AMNV-7QK21-9PZ0R';
/**
 * A phone that appears nowhere else in the fixture set, so a match in the page body can only have
 * come from the vendor row. `vendors.claimed_by_phone` is a raw MSISDN belonging to a real
 * business owner and is the one field on that row that must never reach an unauthenticated page.
 */
const CLAIMANT_PHONE = '+2348039998877';
const app = createServer();

async function observedVendor(displayName = 'MAMA PUT KITCHEN'): Promise<VendorRow> {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName,
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

async function claimedVendor(displayName = 'MAMA PUT KITCHEN'): Promise<VendorRow> {
  const v = await observedVendor(displayName);
  const claimed = await vendorsRepo.claim(testDb, {
    vendorId: v.id,
    phone: CLAIMANT_PHONE,
    category: 'food',
    publicCode: CODE,
    now: NOW,
  });
  if (!claimed) throw new Error('claim failed');
  return claimed;
}

async function bodyOf(path: string): Promise<string> {
  return await (await app.request(path)).text();
}

describe('GET /v/:code — the public landing page', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('needs no authentication and serves HTML', async () => {
    await claimedVendor();
    const res = await app.request(`/v/${CODE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('shows the business name and the masked account, never the full number', async () => {
    const v = await claimedVendor();
    const html = await bodyOf(`/v/${CODE}`);
    expect(html).toContain('MAMA PUT KITCHEN');
    expect(html).toContain(v.accountNumber.slice(-4));
    expect(html).not.toContain(v.accountNumber);
  });

  it('escapes the display name — it is bank-supplied text on a public page', async () => {
    await claimedVendor('<script>alert(1)</script>ACME');
    const html = await bodyOf(`/v/${CODE}`);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  /**
   * The hazard SP-V2's review named as this sub-plan's number one: the vendor row carries the
   * claimant's raw phone number, and the whole row is one careless spread away from the response.
   * Asserted in all three forms a Nigerian number gets written in — E.164, bare digits, and the
   * national `0…` form — because an implementation rendering `08039998877` leaks just as badly
   * while a test looking only for `+234…` stays green.
   */
  it('never leaks the claimant phone, in any of its written forms, nor the vendor id', async () => {
    const v = await claimedVendor();
    const stored = await vendorsRepo.findByPublicCode(testDb, CODE);
    // Guard the guard: if the seed silently failed to write a phone, every assertion below would
    // pass against an empty column and prove nothing.
    expect(stored?.claimedByPhone).toBe(CLAIMANT_PHONE);
    expect(CLAIMANT_PHONE.length).toBeGreaterThan(0);

    const digits = CLAIMANT_PHONE.replace(/\D/g, '');
    const national = `0${digits.slice(3)}`;
    const liveRes = await app.request(`/v/${CODE}`);
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');
    const goneRes = await app.request(`/v/${CODE}`);
    // Both pages have to have RENDERED, or every negative assertion below passes vacuously.
    expect(liveRes.status).toBe(200);
    expect(goneRes.status).toBe(410);
    const live = await liveRes.text();
    const gone = await goneRes.text();

    for (const html of [live, gone]) {
      expect(html).not.toContain(CLAIMANT_PHONE);
      expect(html).not.toContain(digits);
      expect(html).not.toContain(national);
      expect(html).not.toContain(v.id);
    }
  });

  it('404s an unknown code and 410s a suspended one, both HTML, and they read differently', async () => {
    const missing = await app.request('/v/AMNV-ZZZZZ-ZZZZZ');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('text/html');
    const missingHtml = await missing.text();

    const v = await claimedVendor();
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');
    const gone = await app.request(`/v/${CODE}`);
    expect(gone.status).toBe(410);
    expect(gone.headers.get('content-type')).toContain('text/html');
    const goneHtml = await gone.text();

    // A payer standing in a shop has to be told which of the two happened. "This code was real and
    // is now dead" and "this code never existed" are different facts about the business in front
    // of them, so the two pages must not be interchangeable prose.
    expect(missingHtml).toContain('not recognised');
    expect(missingHtml).not.toContain('no longer active');
    expect(goneHtml).toContain('no longer active');
    expect(goneHtml).not.toContain('not recognised');
  });

  /**
   * The status check must be an ALLOW-list, matching `vendorCodeLookupService`. Written as
   * `status === 'suspended' ? 410 : 200` the page would stamp "Verified on Amana" on an `observed`
   * row — a vendor nobody has proven they own — and on every status added to the enum later,
   * while the in-app pay path answers 404 for that same row.
   */
  it('404s an observed row carrying a code — the page never verifies an unproven vendor', async () => {
    const v = await observedVendor();
    await testDb.update(vendors).set({ publicCode: CODE }).where(eq(vendors.id, v.id));
    const res = await app.request(`/v/${CODE}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain('Verified on Amana');
    expect(html).not.toContain('MAMA PUT KITCHEN');
  });

  it('400s a malformed code, as HTML', async () => {
    const res = await app.request('/v/not-a-code');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('is self-contained — no external scripts, styles or images', async () => {
    await claimedVendor();
    const res = await app.request(`/v/${CODE}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/(?!pay\.amana\.ng)/i);
  });

  /**
   * The requested code is attacker-controlled text, and echoing it into the "unknown code" page is
   * what a naive implementation does. It is not echoed at all here, which is stronger than
   * escaping it.
   */
  it('does not echo the requested code back into any page', async () => {
    const unknown = 'AMNV-ZZZZZ-ZZZZZ';
    const res = await app.request(`/v/${unknown}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('not recognised');
    expect(html).not.toContain(unknown);
    expect(html).not.toContain('ZZZZZ');
  });

  /**
   * Someone reading a code off a shop window types what they see. `normalizeCrockford` folds
   * `I`/`L`→`1` and `O`→`0` inside `findByPublicCode`, so this route's regex has to let those
   * characters through — a Crockford-only character class would 400 exactly the transcription
   * errors the alphabet was chosen to absorb, and make the fold dead code.
   */
  it('resolves a hand-transcribed code — lower case, and O typed for zero', async () => {
    await claimedVendor();
    const typed = CODE.toLowerCase().replace(/0/g, 'O');
    expect(typed).not.toBe(CODE);
    const res = await app.request(`/v/${typed}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MAMA PUT KITCHEN');
  });

  /**
   * Padding is a format defect, like a missing dash — repaired at the schema, not in the character
   * fold. `findByPublicCode` normalizes but deliberately does NOT trim, so `.trim()` on this
   * schema is the only place a padded code gets repaired; without it a pasted `" AMNV-… "` 400s.
   */
  it('tolerates a padded code — trim is format repair, and the fold does not do it', async () => {
    await claimedVendor();
    const res = await app.request(`/v/%20${CODE}%20`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MAMA PUT KITCHEN');
  });

  /**
   * `U` is the one glyph dropped from the alphabet with no digit to fold onto, so it is a code
   * character that cannot occur — a miss, not malformed input. Same ruling as `/vendors/code/:code`.
   */
  it('treats U as a miss (404), not as a malformed code (400)', async () => {
    expect((await app.request('/v/AMNV-UUUUU-UUUUU')).status).toBe(404);
  });

  /**
   * The page is self-contained by construction; the CSP makes that an enforced property rather
   * than a property of today's markup. Values are asserted, not merely presence: `default-src *`
   * would satisfy a bare `toContain('default-src')`.
   */
  it('sends a restrictive CSP and the hardening headers on every status', async () => {
    const v = await claimedVendor();
    const live = await app.request(`/v/${CODE}`);
    const missing = await app.request('/v/AMNV-ZZZZZ-ZZZZZ');
    const malformed = await app.request('/v/not-a-code');
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');
    const gone = await app.request(`/v/${CODE}`);

    for (const res of [live, missing, malformed, gone]) {
      const csp = res.headers.get('content-security-policy');
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
      // A hashed <style> is allowed; a blanket inline allowance is not.
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  /**
   * Derived from the SERVED body, not from the module constant. A constant-to-constant assertion
   * would stay green while the emitted markup drifted from the hash by a single space — and the
   * failure mode is an unstyled page in a shop window that no test catches.
   */
  it('allows its own style block by hash — the hash matches the CSS actually served', async () => {
    await claimedVendor();
    const res = await app.request(`/v/${CODE}`);
    const html = await res.text();
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(css).toBeTruthy();
    const expected = createHash('sha256')
      .update(css as string, 'utf8')
      .digest('base64');
    expect(res.headers.get('content-security-policy')).toContain(`'sha256-${expected}'`);
  });

  /**
   * Suspension is a safety control whose whole point is to take effect at once. A suspended
   * vendor's page sitting in a CDN or a browser cache still advertises a live business, so the
   * page is never stored. The database is protected by the rate limiter instead — the control
   * that can say no without going stale.
   */
  it('is never cached, whatever the status', async () => {
    const v = await claimedVendor();
    const live = await app.request(`/v/${CODE}`);
    const missing = await app.request('/v/AMNV-ZZZZZ-ZZZZZ');
    const malformed = await app.request('/v/not-a-code');
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');
    const gone = await app.request(`/v/${CODE}`);

    for (const res of [live, missing, malformed, gone]) {
      expect(res.headers.get('cache-control')).toContain('no-store');
    }
  });

  /**
   * Public, unauthenticated, and it reaches Postgres on every request. The code is unguessable at
   * 32^10, so this is not an enumeration defence — it is there so a sticker photographed off a
   * shop window cannot be turned into free load on the API's database.
   */
  it('rate-limits the page by client IP', async () => {
    // Malformed on purpose: the limiter runs ahead of the handler, so the bucket is exhausted
    // without seeding a vendor or touching Postgres.
    const burn = '/v/AMNV-7QK2!-9PZ0R';
    // Pin the SIZE, not just the presence. The burn below reaches 429 under any limit at all, so
    // swapping this route onto the auth surface's much smaller allowance would slip past it. The
    // page is deliberately an order of magnitude looser: it is keyed on `clientIp`, and behind a
    // Nigerian carrier's CGNAT that key is a whole city, not a payer.
    const first = await app.request(burn);
    expect(first.headers.get('x-ratelimit-limit')).toBe(String(env.RATE_LIMIT_VENDOR_PAGE_PER_IP));
    expect(env.RATE_LIMIT_VENDOR_PAGE_PER_IP).toBeGreaterThan(env.RATE_LIMIT_AUTH_PER_IP);

    let last = 0;
    for (let i = 0; i <= env.RATE_LIMIT_VENDOR_PAGE_PER_IP; i++) {
      last = (await app.request(burn)).status;
    }
    expect(last).toBe(429);
  });
});
