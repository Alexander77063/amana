import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendors } from '../../src/db/schema';
import { env } from '../../src/env';
import { err, ok } from '../../src/lib/result';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { nameEnquiryService } from '../../src/modules/vendors/name-enquiry.service';
import { type VendorRow, vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-10T10:00:00Z');
/**
 * A minted code, in minted form: upper-case, Crockford-minus-ILOU. It deliberately contains both
 * a `1` and a `0`, because those are the two digits `normalizeCrockford` folds INTO — a code with
 * neither cannot prove the fold survives the route's validation.
 */
const CODE = 'AMNV-7QK21-9PZ0R';
const app = createServer();

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    bvn: factories.bvn(),
    kycTier: '2',
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: factories.bankAccount(),
    anchorBankCode: '058',
    anchorAccountId: `anchor-acct-${factories.householdId()}`,
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { principal, agent, subWalletId: sw.sub.id };
}

async function claimedVendor(code = CODE): Promise<VendorRow> {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  const claimed = await vendorsRepo.claim(testDb, {
    vendorId: v.id,
    phone: factories.phone(),
    category: 'food',
    publicCode: code,
    now: NOW,
  });
  if (!claimed) throw new Error('claim failed');
  return claimed;
}

function mockNameEnquiry(accountName = 'MAMA PUT KITCHEN') {
  return vi.spyOn(nameEnquiryService, 'lookup').mockImplementation(async (_a, input) =>
    ok({
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountName,
      source: 'name_enquiry' as const,
      suggestedAmountKobo: null,
      vendorId: null,
      category: null,
    }),
  );
}

describe('GET /vendors/code/:code', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('401s without a bearer token', async () => {
    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${factories.walletId()}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });

  it('returns the resolved vendor with its registry identity', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const v = await claimedVendor();
    mockNameEnquiry('MAMA PUT KITCHEN LTD');

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      // NIBSS wins over the stored displayName — the whole point of enquiring on every scan.
      accountName: 'MAMA PUT KITCHEN LTD',
      source: 'vendor_code',
      suggestedAmountKobo: null,
      vendorId: v.id,
      category: 'food',
    });
  });

  /**
   * The reason the alphabet drops I/L/O is that a human transcribing a code off a shop window
   * will type them for 1/1/0. `normalizeCrockford` folds them back — but only if the route's
   * validation lets them through first. Tightening the route regex to the minted alphabet makes
   * that entire fold dead code, so this test is what stands between the two.
   *
   * The typed forms are FULLY lower-case, prefix included, because that is what someone typing
   * the whole thing into a keyboard produces — and a case-sensitive `AMNV-` prefix would 400 it
   * one character before the interesting part.
   */
  it.each([
    ['fully lower-case', 'amnv-7qk21-9pz0r'],
    ['I typed for 1, O typed for 0', 'amnv-7qk2i-9pzor'],
    ['L typed for 1, upper-case O for 0', 'AMNV-7QK2L-9PZOR'],
    ['mixed case', 'Amnv-7Qk2I-9pZoR'],
  ])('resolves a code transcribed as %s', async (_label, typed) => {
    const { agent, subWalletId } = await seedSubWallet();
    const v = await claimedVendor();
    mockNameEnquiry();

    const res = await app.request(`/vendors/code/${typed}?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { vendorId: string }).vendorId).toBe(v.id);
  });

  /**
   * A trailing space off a mobile keyboard, or a WhatsApp paste. Padding is a FORMAT defect, like
   * a missing dash or a four-symbol group, so it is repaired in the schema alongside every other
   * format rule — not in `normalizeCrockford`, which folds characters and would otherwise start
   * silently accepting padding on surfaces whose own regexes still reject it.
   */
  it('resolves a code with surrounding whitespace', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const v = await claimedVendor();
    mockNameEnquiry();

    const url = `/vendors/code/${encodeURIComponent(` ${CODE} `)}?subWalletId=${subWalletId}`;
    const res = await app.request(url, { headers: await bearerHeaders(agent) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { vendorId: string }).vendorId).toBe(v.id);
  });

  it('404s a well-formed code that does not exist', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const res = await app.request(`/vendors/code/AMNV-ZZZZZ-ZZZZZ?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  /**
   * The status check is an allow-list, and this is what that buys. Only `claim()` writes a
   * `publicCode`, atomically with `status: 'claimed'`, so a code on an observed row can only have
   * got there by hand — and nobody has proven they own that account, so it must not be payable.
   * The row is written straight through drizzle precisely because no repo method can produce it.
   *
   * The `default:` arm of the same switch is structurally unreachable — it exists so that adding
   * a fourth `vendorStatusEnum` member fails to compile, which is verified by the type-checker,
   * not by a test.
   */
  it('404s a code sitting on a vendor that was never claimed', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'MAMA PUT KITCHEN',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    expect(v.status).toBe('observed');
    await testDb.update(vendors).set({ publicCode: CODE }).where(eq(vendors.id, v.id));
    const enquiry = mockNameEnquiry();

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(404);
    // Refused before the account was ever enquired against, not after.
    expect(enquiry).not.toHaveBeenCalled();
  });

  /**
   * `U` is the one glyph that is neither in the alphabet nor foldable — there is no digit it is
   * mistaken for. So a `U` is a code CHARACTER that cannot occur, not a malformed code: it must
   * reach the lookup and miss. Rejecting it at the route would turn a wrong-but-well-formed code
   * into "malformed input", which is a different thing to tell a payer standing in a shop.
   */
  it('lets U through validation and misses it as a 404, having queried the registry', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const spy = vi.spyOn(vendorsRepo, 'findByPublicCode');
    const res = await app.request(`/vendors/code/AMNV-UUUUU-uuuuu?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(404);
    expect(spy).toHaveBeenCalled();
  });

  /**
   * 410, matching `STICKER_REVOKED` on the sibling route: the same shape, a real identifier whose
   * subject has been withdrawn. Task 3's public page answers the same condition the same way, so
   * a suspension reads identically whether the code is scanned in-app or opened in a browser.
   */
  it('410s a suspended vendor, distinguishably from an unknown code', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const headers = await bearerHeaders(agent);
    const v = await claimedVendor();
    mockNameEnquiry();
    await vendorsRepo.setStatus(testDb, v.id, 'suspended');

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, { headers });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'VENDOR_SUSPENDED' });
  });

  /**
   * The code is real; the bank account behind it is not, any more. 409 — "a conflict with
   * reality", the same phrase SP-V2's `ownership_unproved` uses for the same shape.
   *
   * It is TERMINAL: nothing on our side can bring that account back, so the one thing the status
   * must not do is invite a retry. That rules out BOTH 5xx candidates — 502 and 503 are alike in
   * sitting in the default retry set for idempotent GETs in axios-retry and most fetch wrappers.
   * Which is exactly why `VENDOR_ENQUIRY_FAILED` keeps 502 and this does not: that one genuinely
   * is retryable, and this one would never succeed.
   */
  it('409s a real code whose bank account NIBSS no longer knows', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    await claimedVendor();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'VENDOR_ACCOUNT_GONE' });
  });

  /**
   * A throttled or rejected enquiry must never surface as `BAD_INPUT`. On this path the bank code
   * and account number are ours, off a vendor row whose code has already been proven real, so
   * "bad input" would blame a shopkeeper holding a perfectly correct code — and `BAD_INPUT`'s
   * message is literally `Anchor 429`, which names our banking partner to the caller.
   */
  it('502s a rejected enquiry as its own code, never as BAD_INPUT and never naming Anchor', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    await claimedVendor();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(
      err({ code: 'BAD_INPUT', message: 'Anchor 429' }),
    );

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: 'VENDOR_ENQUIRY_FAILED' });
    expect(raw).not.toContain('Anchor');
    expect(raw).not.toContain('429');
  });

  it('503s when NIBSS is unreachable, so the client can offer a retry', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    await claimedVendor();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'PARTNER_DOWN' }));

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'PARTNER_DOWN' });
  });

  /**
   * Grouping and the prefix are the part of the format that IS structural: no fold can repair a
   * missing dash or a four-symbol group, so those are malformed input and must 400 before the
   * database is touched. Each case pins one property of the regex that a future edit could relax.
   */
  it.each([
    ['not a code at all', 'not-a-code'],
    ['wrong prefix', 'AMN-7QK21-9PZ0R'],
    ['short group', 'AMNV-7QK2-9PZ0R'],
    ['long group', 'AMNV-7QK21X-9PZ0R'],
    ['missing a dash', 'AMNV-7QK219PZ0R'],
    ['only one group', 'AMNV-7QK21'],
    ['trailing junk', 'AMNV-7QK21-9PZ0R-'],
    ['a non-alphanumeric symbol', 'AMNV-7QK2!-9PZ0R'],
  ])('400s a code that is %s, without touching the database', async (_label, code) => {
    const { agent, subWalletId } = await seedSubWallet();
    const spy = vi.spyOn(vendorsRepo, 'findByPublicCode');
    const url = `/vendors/code/${encodeURIComponent(code)}?subWalletId=${subWalletId}`;
    const res = await app.request(url, { headers: await bearerHeaders(agent) });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('400s a subWalletId that is not a UUID, rather than letting Postgres 500', async () => {
    const { agent } = await seedSubWallet();
    const res = await app.request(`/vendors/code/${CODE}?subWalletId=not-a-uuid`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(400);
  });

  it('400s a missing subWalletId', async () => {
    const { agent } = await seedSubWallet();
    const res = await app.request(`/vendors/code/${CODE}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(400);
  });

  it('403s a sub-wallet the caller does not own', async () => {
    const mine = await seedSubWallet();
    const theirs = await seedSubWallet();
    await claimedVendor();
    mockNameEnquiry();

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${theirs.subWalletId}`, {
      headers: await bearerHeaders(mine.agent),
    });
    expect(res.status).toBe(403);
  });

  /**
   * A non-existent sub-wallet is 403, not 404 — deliberately indistinguishable from someone
   * else's, which is what every sibling route does. Pinned so a future "helpful" 404 is caught.
   */
  it('403s a well-formed sub-wallet id that does not exist', async () => {
    const { agent } = await seedSubWallet();
    await claimedVendor();
    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${factories.walletId()}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(403);
  });

  /**
   * Every valid code costs one Anchor name enquiry, on the circuit breaker the spend path shares.
   * The limiter exists so scans cannot trip that breaker — but its pattern must stay narrow, or
   * the cure is worse than the disease: a limiter accidentally covering `/vendors/*` would throttle
   * the spend-path reads it was added to protect.
   *
   * It is keyed on the authenticated account rather than the client IP, which is why it lives on
   * `vendorsRoute` after `jwtAuth()` instead of in `attachRateLimiters` — the app-level limiters
   * run before `app.route('/vendors', …)`, so `c.get('actor')` is unset there. All three halves
   * are asserted here: the burn, the untouched sibling, and a second account that must still pass.
   */
  it('rate-limits the code surface per account, without touching its sibling vendor routes', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const headers = await bearerHeaders(agent);
    // Malformed on purpose: the limiter runs ahead of the handler, so this exhausts the bucket
    // without seeding a vendor or reaching Postgres.
    const burn = `/vendors/code/AMNV-7QK2!-9PZ0R?subWalletId=${subWalletId}`;
    let last = 0;
    for (let i = 0; i <= env.RATE_LIMIT_AUTH_PER_IP; i++) {
      last = (await app.request(burn, { headers })).status;
    }
    expect(last).toBe(429);

    // The bucket is spent. A sibling vendors route must still answer.
    const sibling = await app.request(`/vendors/recents?subWalletId=${subWalletId}`, { headers });
    expect(sibling.status).toBe(200);

    // The half that discriminates an ACCOUNT key from an IP key. Every request in this harness
    // carries the same (absent) client IP, so under the old `clientIp` key this second, unrelated
    // account would already be locked out by the first one's burn. That shared bucket was not a
    // test artefact: Nigerian carriers CGNAT, so in production one egress address is thousands of
    // subscribers, and this is a payment-path read where a false positive costs a payment.
    // 400, not 429 — it reached the handler's validation, which is proof it passed the limiter.
    const other = await seedSubWallet();
    const otherRes = await app.request(
      `/vendors/code/AMNV-7QK2!-9PZ0R?subWalletId=${other.subWalletId}`,
      { headers: await bearerHeaders(other.agent) },
    );
    expect(otherRes.status).toBe(400);
  });

  /**
   * `vendors.claimedByPhone` is the business owner's raw phone number. It is one careless spread
   * of the vendor row away from this response body, and nothing else in the suite would notice.
   */
  it('never returns the claimant phone number', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const v = await claimedVendor();
    const phone = v.claimedByPhone;
    if (!phone) throw new Error('fixture did not store a claimant phone');
    mockNameEnquiry();

    const res = await app.request(`/vendors/code/${CODE}?subWalletId=${subWalletId}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(phone);
    // The bare digits too, in case a future serializer strips the leading `+`.
    expect(raw).not.toContain(phone.replace(/\D/g, ''));
  });
});
