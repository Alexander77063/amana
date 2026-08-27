import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/env';
import { logger } from '../../src/lib/logger';
import { err, ok } from '../../src/lib/result';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { stickersRepo } from '../../src/modules/sticker/stickers.repo';
import { nameEnquiryService } from '../../src/modules/vendors/name-enquiry.service';
import { encodeTlvForTest } from '../../src/modules/vendors/nqr-decoder';
import { phoneLookupService } from '../../src/modules/vendors/phone-lookup.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
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
  return { agent, agentId: agent.id, subWalletId: sw.sub.id };
}

describe('GET /vendors/sticker/:uuid', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 with ResolvedVendor for an active sticker', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA',
      vendorPhone: factories.phone(),
      status: 'active',
    });
    const app = createServer();
    const headers = await bearerHeaders(agent);
    const res = await app.request(`/vendors/sticker/${sticker.uuid}?subWalletId=${subWalletId}`, {
      headers,
    });
    expect(res.status).toBe(200);
    // The WHOLE body, not two fields. All five resolution endpoints now serialize through one
    // `toResolvedVendorResponse`, so a mapper that dropped `vendorId` or `category` — or that
    // started emitting `"0"` where `null` belongs — would pass a two-field assertion on every
    // path at once. Each endpoint pins its full shape so the shared mapper cannot regress
    // silently.
    expect(await res.json()).toEqual({
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA',
      source: 'sticker',
      suggestedAmountKobo: null,
      vendorId: null,
      category: null,
    });
  });

  it('404 for unknown sticker', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const app = createServer();
    const headers = await bearerHeaders(agent);
    const res = await app.request(
      `/vendors/sticker/${factories.txnId()}?subWalletId=${subWalletId}`,
      { headers },
    );
    expect(res.status).toBe(404);
  });

  it('401 without bearer', async () => {
    const { subWalletId } = await seedSubWallet();
    const app = createServer();
    const res = await app.request(
      `/vendors/sticker/${factories.txnId()}?subWalletId=${subWalletId}`,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });
});

describe('GET /vendors/recents', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 with empty array when no recents', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const app = createServer();
    const headers = await bearerHeaders(agent);
    const res = await app.request(`/vendors/recents?subWalletId=${subWalletId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recents).toEqual([]);
  });
});

/**
 * Both NIBSS enquiry endpoints make a PAID partner call, on the process-global circuit breaker
 * the spend path shares, and were unthrottled — available to any authenticated user with a
 * sub-wallet. The limiter registered on `/code/*` is extended over both.
 *
 * The two out-of-scope siblings are asserted alongside, because the failure mode of getting the
 * patterns wrong is worse than the gap: a limiter that drifted to `/vendors/*` would throttle the
 * spend-path reads it was added to protect.
 */
describe('the Anchor-costing enquiry endpoints are rate-limited per account', () => {
  beforeEach(async () => {
    // `truncateAll` also calls `resetRateLimitStore`, so each test starts with a fresh bucket.
    await truncateAll();
  });
  // The service spies below must not follow this describe into the next one.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      'name-enquiry',
      (sw: string) =>
        `/vendors/name-enquiry?bankCode=058&accountNumber=0123456789&subWalletId=${sw}`,
    ],
    [
      'phone-lookup',
      (sw: string) => `/vendors/phone-lookup?phoneNumber=%2B2348010000000&subWalletId=${sw}`,
    ],
  ] as const)('burns down to 429 on /vendors/%s', async (_name, url) => {
    const { agent, subWalletId } = await seedSubWallet();
    const app = createServer();
    const headers = await bearerHeaders(agent);
    // Every call is short-circuited before Anchor: the point under test is the limiter, and a
    // real partner call per iteration is exactly what the limiter exists to prevent.
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));
    vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));

    let last = 0;
    for (let i = 0; i <= env.RATE_LIMIT_VENDOR_ANCHOR_PER_ACTOR; i++) {
      last = (await app.request(url(subWalletId), { headers })).status;
    }
    expect(last).toBe(429);

    // Out of scope on purpose — both are pure Postgres reads and must not be throttled by an
    // Anchor-cost limiter. `/sticker/:uuid` 404s here (nothing seeded); the assertion is only
    // that it is not 429.
    const recents = await app.request(`/vendors/recents?subWalletId=${subWalletId}`, { headers });
    expect(recents.status).toBe(200);
    const sticker = await app.request(
      `/vendors/sticker/${factories.walletId()}?subWalletId=${subWalletId}`,
      { headers },
    );
    expect(sticker.status).not.toBe(429);
  });

  /**
   * The half that discriminates an ACCOUNT key from an IP key. Every request in this harness
   * carries the same (absent) client IP, so under an IP key this unrelated second account would
   * already be locked out. Nigerian carriers CGNAT, so in production one egress address is
   * thousands of subscribers, and this is a payment-path read where a false positive costs a
   * payment rather than a login retry.
   */
  it('a second account is untouched by the first account burning its bucket', async () => {
    const first = await seedSubWallet();
    const app = createServer();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code: 'NOT_FOUND' }));
    const url = (sw: string) =>
      `/vendors/name-enquiry?bankCode=058&accountNumber=0123456789&subWalletId=${sw}`;
    const firstHeaders = await bearerHeaders(first.agent);
    for (let i = 0; i <= env.RATE_LIMIT_VENDOR_ANCHOR_PER_ACTOR; i++) {
      await app.request(url(first.subWalletId), { headers: firstHeaders });
    }

    const other = await seedSubWallet();
    const res = await app.request(url(other.subWalletId), {
      headers: await bearerHeaders(other.agent),
    });
    // 404, not 429 — it reached the handler, which is proof it passed the limiter.
    expect(res.status).toBe(404);
  });
});

/**
 * `nameEnquiryService` builds its `BAD_INPUT` message as `Anchor <status>` — our banking
 * partner's name and its exact upstream status. Both enquiry endpoints returned that verbatim in
 * a `detail` field. To an authenticated caller that is free reconnaissance, and it becomes a
 * probing oracle as soon as someone maps which inputs produce which upstream codes.
 *
 * The `BAD_INPUT` VARIANT stays: on these two paths the caller really did supply the account
 * number or the phone, so "bad input" is the honest answer. It is only the message that is
 * withheld — and it is not discarded, it goes to the log, where an operator debugging a rejected
 * enquiry still needs the real status.
 */
describe('the enquiry endpoints do not relay the upstream failure to the caller', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  // The logger spy is process-wide and `singleFork: true` means one process for the whole run.
  // Restoring on the way out keeps it from following whatever describe gets appended below.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /vendors/name-enquiry never names the partner or its status', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(
      err({ code: 'BAD_INPUT', message: 'Anchor 429' }),
    );
    const app = createServer();
    const res = await app.request(
      `/vendors/name-enquiry?bankCode=058&accountNumber=0123456789&subWalletId=${subWalletId}`,
      { headers: await bearerHeaders(agent) },
    );
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: 'BAD_INPUT' });
    expect(raw).not.toContain('Anchor');
    expect(raw).not.toContain('429');

    // Withheld from the caller, NOT discarded: the operator debugging this still needs the real
    // upstream status. Without this half asserted, deleting the log line would pass every other
    // assertion in this block.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: 'Anchor 429',
        code: 'BAD_INPUT',
        accountNumber: '0123456789',
      }),
      expect.any(String),
    );
  });

  it('GET /vendors/phone-lookup never names the partner or its status', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(
      err({ code: 'BAD_INPUT', message: 'Anchor 403' }),
    );
    const app = createServer();
    const res = await app.request(
      `/vendors/phone-lookup?phoneNumber=%2B2348010000000&subWalletId=${subWalletId}`,
      { headers: await bearerHeaders(agent) },
    );
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: 'BAD_INPUT' });
    expect(raw).not.toContain('Anchor');
    expect(raw).not.toContain('403');

    // The number rides as `phone`, the exact key `redactConfig` censors — never interpolated
    // into a message, where the redactor could not reach it.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'Anchor 403', phone: '+2348010000000' }),
      expect.any(String),
    );
  });

  /**
   * The real `phoneLookupService`, not a mock: its E.164 rejection is the other `BAD_INPUT`
   * source on this route, and it interpolated the caller's phone number into the message. Echoing
   * back what the caller typed leaks nothing to them, but it put a raw phone in a response body
   * — and, once the message is logged, in the logs, where the redactor cannot reach inside a
   * string. The variant is still the honest 400.
   */
  it('GET /vendors/phone-lookup does not echo the rejected phone number', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const app = createServer();
    const res = await app.request(
      `/vendors/phone-lookup?phoneNumber=08010000000&subWalletId=${subWalletId}`,
      { headers: await bearerHeaders(agent) },
    );
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: 'BAD_INPUT' });
    expect(raw).not.toContain('08010000000');
  });

  /**
   * Extracting the two handlers into one `enquiryFailure` also made their status ladder shared
   * code. `NOT_FOUND` and `PARTNER_DOWN` used to return `detail: null` and now return no
   * `detail` key at all, so both the ladder and the new body shape are pinned here — the three
   * tests above only ever reach the `BAD_INPUT` arm.
   */
  it.each([
    ['NOT_FOUND', 404],
    ['PARTNER_DOWN', 503],
  ] as const)('relays %s as %i with the code alone', async (code, status) => {
    const { agent, subWalletId } = await seedSubWallet();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(err({ code }));
    const app = createServer();
    const res = await app.request(
      `/vendors/name-enquiry?bankCode=058&accountNumber=0123456789&subWalletId=${subWalletId}`,
      { headers: await bearerHeaders(agent) },
    );
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
    // Nothing to withhold, so nothing to log: only a message-bearing error is worth an operator's
    // attention, and these two carry none.
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * A merchant QR, built the way NIBSS builds one: bank code and account number nested under the
 * merchant info template (tag 26), with the optional amount (tag 54) and merchant name (tag 59)
 * at the top level. `amountNaira` is the tag 54 value verbatim, because that is what the decoder
 * is handed off a real sticker.
 */
function nqrPayload(amountNaira?: string): string {
  const merchantInfo =
    encodeTlvForTest('00', 'NG.NIBSS') +
    encodeTlvForTest('01', '058') +
    encodeTlvForTest('02', '0123456789');
  return (
    encodeTlvForTest('26', merchantInfo) +
    (amountNaira === undefined ? '' : encodeTlvForTest('54', amountNaira)) +
    encodeTlvForTest('59', 'MAMA PUT KITCHEN')
  );
}

/**
 * `POST /vendors/nqr-decode` returned 500 for every QR that carried an amount — the standard
 * "scan to pay ₦2,000" sticker, and the entire reason NQR defines tag 54.
 *
 * `decodeNqr` parses tag 54 into a real `Kobo`, which is a `bigint`, and `bigint` has no JSON
 * representation: `JSON.stringify({ a: 1n })` throws `TypeError: Do not know how to serialize a
 * BigInt`, and Hono's `c.json` is a bare `JSON.stringify`. The throw happened inside the handler,
 * so the caller got a 500 with no hint of the cause.
 *
 * It survived because the bug lives in the gap between two green suites: the decoder's own tests
 * cover tag 54, but at the service layer, where nothing serializes; the only route-level test for
 * this endpoint asserted a 400 on missing fields. Nothing ever put a valid amount-bearing payload
 * through the HTTP boundary. These tests are that boundary.
 */
describe('POST /vendors/nqr-decode', () => {
  beforeEach(async () => {
    await truncateAll();
    // The `nqr` branch confirms the decoded account against NIBSS before answering, so the real
    // service would reach Anchor. What is under test is the serialization at the route boundary,
    // so the partner call is stubbed with the shape it really returns.
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(
      ok({
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'MAMA PUT KITCHEN LTD',
        source: 'name_enquiry',
        suggestedAmountKobo: null,
        vendorId: null,
        category: null,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function decode(payload: string, subWalletId: string, headers: Record<string, string>) {
    return createServer().request('/vendors/nqr-decode', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ payload, subWalletId }),
    });
  }

  it('200 with the embedded amount as a decimal kobo string', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const res = await decode(nqrPayload('2000.00'), subWalletId, await bearerHeaders(agent));
    expect(res.status).toBe(200);
    // `"200000"` — raw kobo, base 10, no separators and no currency, matching every other
    // `…Kobo` field on the wire (`sub-wallets.ts`, `me-bumps.ts`, `vas.ts`) and the `string` the
    // api-client declares. NOT `toNairaString`, which would emit `"2,000.00"`: a different unit,
    // comma-formatted, and not parseable by `BigInt()` on the far side.
    expect(await res.json()).toEqual({
      bankCode: '058',
      accountNumber: '0123456789',
      // NIBSS wins over the QR's own tag 59 — we confirm the account rather than trust the QR.
      accountName: 'MAMA PUT KITCHEN LTD',
      source: 'nqr',
      suggestedAmountKobo: '200000',
      vendorId: null,
      category: null,
    });
  });

  it('keeps the kobo remainder — 5200.50 is 520050, not 5200 or 5200.50', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const res = await decode(nqrPayload('5200.50'), subWalletId, await bearerHeaders(agent));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestedAmountKobo).toBe('520050');
    // The conversion has to be lossless in both directions: whatever the client does with this
    // string, `BigInt()` of it must be the exact kobo the decoder produced. A naira-formatted
    // string would satisfy a loose assertion and throw here.
    expect(BigInt(body.suggestedAmountKobo)).toBe(520050n);
  });

  /**
   * `0n` is falsy, so the obvious `v.suggestedAmountKobo ? … : null` mapper turns a zero-amount
   * QR into `null` — the client then prompts for an amount on a sticker that deliberately said
   * zero. The `=== null` form is what the sibling routes use (`sub-wallets.ts`) and it is the
   * only one that survives this test.
   */
  it('a zero-amount tag 54 is "0", not null', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const res = await decode(nqrPayload('0.00'), subWalletId, await bearerHeaders(agent));
    expect(res.status).toBe(200);
    expect((await res.json()).suggestedAmountKobo).toBe('0');
  });

  it('null — not "0" and not "null" — when the QR carries no amount', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const res = await decode(nqrPayload(), subWalletId, await bearerHeaders(agent));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(JSON.parse(raw).suggestedAmountKobo).toBeNull();
    // Pinned on the raw text as well: a mapper that emitted the STRING `"null"` would satisfy a
    // truthiness check and quietly become an amount on the confirm screen.
    expect(raw).toContain('"suggestedAmountKobo":null');
  });

  it('400 for a payload that is not a QR at all', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const res = await decode('not-a-qr', subWalletId, await bearerHeaders(agent));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('BAD_INPUT');
  });
});

/**
 * `/vendors/name-enquiry` and `/phone-lookup` had no 200-shape test at all — every existing test
 * on them mocks a FAILURE. With all five resolution endpoints now sharing one mapper, that left
 * two of the five with no regression guard whatsoever.
 */
describe('the enquiry endpoints return the full ResolvedVendor shape on 200', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /vendors/name-enquiry', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    vi.spyOn(nameEnquiryService, 'lookup').mockResolvedValue(
      ok({
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'MUSA ABDULLAHI',
        source: 'name_enquiry',
        suggestedAmountKobo: null,
        vendorId: null,
        category: null,
      }),
    );
    const app = createServer();
    const res = await app.request(
      `/vendors/name-enquiry?bankCode=058&accountNumber=0123456789&subWalletId=${subWalletId}`,
      { headers: await bearerHeaders(agent) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA ABDULLAHI',
      source: 'name_enquiry',
      suggestedAmountKobo: null,
      vendorId: null,
      category: null,
    });
  });

  it('GET /vendors/phone-lookup', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    vi.spyOn(phoneLookupService, 'lookup').mockResolvedValue(
      ok({
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'MUSA ABDULLAHI',
        source: 'phone_lookup',
        suggestedAmountKobo: null,
        vendorId: null,
        category: null,
      }),
    );
    const app = createServer();
    const res = await app.request(
      `/vendors/phone-lookup?phoneNumber=%2B2348010000000&subWalletId=${subWalletId}`,
      { headers: await bearerHeaders(agent) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA ABDULLAHI',
      source: 'phone_lookup',
      suggestedAmountKobo: null,
      vendorId: null,
      category: null,
    });
  });
});
