import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/env';
import { logger } from '../../src/lib/logger';
import { err } from '../../src/lib/result';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { stickersRepo } from '../../src/modules/sticker/stickers.repo';
import { nameEnquiryService } from '../../src/modules/vendors/name-enquiry.service';
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
    const body = await res.json();
    expect(body.accountName).toBe('MUSA');
    expect(body.source).toBe('sticker');
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
