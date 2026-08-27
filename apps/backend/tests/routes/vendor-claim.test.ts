import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/env';
import { drainBackgroundTasks } from '../../src/lib/background';
import { resetRateLimitStore } from '../../src/middleware/rate-limit';
import { otpService } from '../../src/modules/auth/otp.service';
import { vendorClaimsRepo } from '../../src/modules/vendors/vendor-claims.repo';
import { CURRENT_TERMS_VERSION } from '../../src/modules/vendors/vendor-consent.service';
import { vendorOwnershipService } from '../../src/modules/vendors/vendor-ownership.service';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const app = createServer();

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /vendor-claim', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('needs no authentication', async () => {
    const res = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    expect(res.status).not.toBe(401);
  });

  it('is a NON-ORACLE: byte-identical responses for registered and unregistered accounts', async () => {
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    const known = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    const unknown = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '9999999999',
      phone: '+2348019999999',
    });

    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
  });

  it('is a NON-ORACLE at /verify too: an unknown phone and a wrong code are byte-identical', async () => {
    // `verify` now checks the CODE first and only then looks at the account (GATE 3), so an
    // unproven caller can no longer read registry membership off this endpoint at all. The
    // collapse is kept anyway: it costs nothing, and it is what stops a future edit that
    // reintroduces an early, account-shaped return from silently reopening the channel.
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
    // Has a pending attempt, wrong code.
    const wrongCode = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '000000',
      category: 'food',
    });
    // A phone with no live challenge at all. Before GATE 3 this took a cheaper, earlier path
    // (`no_attempt`, decided by a SELECT before the OTP was checked); now every unproven
    // caller lands on the same argon2-priced `invalid_code`.
    const noAttempt = await post('/vendor-claim/verify', {
      phone: '+2348017654321',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '000000',
      category: 'food',
    });

    expect(wrongCode.status).toBe(401);
    expect(noAttempt.status).toBe(wrongCode.status);
    expect(await noAttempt.text()).toBe(await wrongCode.text());
  });

  it('is a NON-ORACLE at /verify for an EXHAUSTED attempt too, not just a wrong code', async () => {
    // `too_many_attempts` can only ever come back from `verifyCode`. Since GATE 3 that no longer
    // implies a promoted vendor — the account is not consulted until after the code — so what it
    // would leak is weaker: that this phone had a live `vendor_claim` challenge to exhaust. Still
    // free to withhold, so it stays collapsed.
    //
    // Driven through the REAL otp service (no `verifyCode` mock) so the exhaustion is the
    // production one, argon2 and all.
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const phone = '+2348012345678';
    // Spy WITHOUT a mock implementation: calls through, but records what the service actually got
    // back, so this test cannot pass by never reaching the exhausted branch at all.
    const verify = vi.spyOn(otpService, 'verifyCode');

    await post('/vendor-claim/request', { bankCode: '058', accountNumber: '0123456789', phone });
    // `requestCode` is detached (`runInBackground`) and it is what writes the challenge row.
    await drainBackgroundTasks();

    const wrongCode: Array<{ status: number; body: string }> = [];
    for (let i = 0; i < env.OTP_MAX_ATTEMPTS; i++) {
      // Reset per iteration, not only before the sixth call: the loop must survive
      // `OTP_MAX_ATTEMPTS` being tuned ABOVE `RATE_LIMIT_OTP_PER_PHONE`, which is exactly the
      // tuning this finding warns reopens the leak. See the note below the loop.
      resetRateLimitStore();
      const res = await post('/vendor-claim/verify', {
        phone,
        code: '000000',
        bankCode: '058',
        accountNumber: '0123456789',
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
      });
      wrongCode.push({ status: res.status, body: await res.text() });
    }

    // The per-phone limiter on this path is `RATE_LIMIT_OTP_PER_PHONE` (5), which today happens to
    // equal `OTP_MAX_ATTEMPTS` (5) — so on ONE machine the sixth call 429s before the service sees
    // it. That coincidence is precisely what must not be relied on: the limiter is in-memory and
    // per-instance, and `auto_start_machines = true`. Resetting the store here stands in for the
    // second Fly machine, which starts with an empty one. Do not "simplify" this away.
    resetRateLimitStore();
    const exhausted = await post('/vendor-claim/verify', {
      phone,
      code: '000000',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    const noAttempt = await post('/vendor-claim/verify', {
      phone: '+2348017654321',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '000000',
    });

    // The sixth call really did exhaust the challenge rather than merely miss again.
    expect(await verify.mock.results[env.OTP_MAX_ATTEMPTS]?.value).toEqual({
      kind: 'too_many_attempts',
    });

    const exhaustedBody = await exhausted.text();
    const noAttemptBody = await noAttempt.text();
    expect(wrongCode[0]?.status).toBe(401);
    expect(exhausted.status).toBe(wrongCode[0]?.status);
    expect(noAttempt.status).toBe(wrongCode[0]?.status);
    expect(exhaustedBody).toBe(wrongCode[0]?.body);
    expect(noAttemptBody).toBe(wrongCode[0]?.body);
  });

  it('409s vendor_unavailable when the vendor stops being claimable behind a verified OTP', async () => {
    // Collapsing this into the 401 was a dead end, not a defence: the claimant's OTP is already
    // consumed, they read "invalid code", and their retry `/request` early-returns on
    // `status !== 'observed'` into the uniform 202 — so no second code ever arrives. It is safe to
    // distinguish because it sits BEHIND the verified OTP, the same gate that protects the
    // deliberately-retained `409 ownership_unproved`.
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    await drainBackgroundTasks();

    // Suspended mid-flow — an ops action, or a second claimant winning the race.
    expect(await vendorsRepo.setStatus(testDb, v.id, 'suspended')).toBe(true);
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    const prove = vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup');

    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'food',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'vendor_unavailable' });
    // Decided before the paid Anchor lookup, so it costs nothing to answer honestly.
    expect(prove).not.toHaveBeenCalled();
  });

  it('400s a category outside the shared spend vocabulary', async () => {
    // Free text here would let a vendor decide whether someone else's spending lock applies: the
    // claimed category REPLACES the app-supplied one before the rule engine compares it.
    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'Food',
    });
    expect(res.status).toBe(400);
  });

  it('re-issues an OTP when the same phone retries after an ownership failure', async () => {
    // The 409 path consumes the OTP but deliberately leaves the attempt `pending` for the ops
    // queue. Before this fix the claimant's next `/request` collided with the one-pending index,
    // got no row, and silently sent no second code — a lockout lasting until the HOURLY sweep.
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const otp = vi
      .spyOn(otpService, 'requestCode')
      .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

    const first = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    expect(first.status).toBe(202);
    // The send is detached (`runInBackground`) so it must be drained before it can be counted.
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(1);

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    const proof = vi
      .spyOn(vendorOwnershipService, 'proveByPhoneLookup')
      .mockResolvedValue({ proved: false, reason: 'mismatch' });
    const unproved = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'food',
    });
    expect(unproved.status).toBe(409);

    // Retry from the SAME phone: still the uniform 202, and now a second code actually goes out.
    const retry = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    expect(retry.status).toBe(202);
    expect(await retry.text()).toBe(await first.text());
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(2);

    // And the recovered attempt still completes the claim.
    proof.mockResolvedValue({
      proved: true,
      proof: 'phone_lookup',
      accountName: 'MAMA PUT KITCHEN',
    });
    const claimed = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'food',
    });
    expect(claimed.status).toBe(200);
    const body = (await claimed.json()) as { publicCode: string };
    expect(body.publicCode).toMatch(/^AMNV-/);
  });

  // Inverted closing PRE-LAUNCH GATE 2. The old name said it plainly — "keeps the land-grab
  // guard" — and the guard was the vulnerability: `/request` proves nothing about phone
  // ownership, so whoever called FIRST, with any phone string, held the vendor's only slot and
  // locked the real owner out until it lapsed. The uniform 202 meant the owner could not even
  // tell. Now both callers get a real attempt and a real code, and the vendor is won at
  // `/verify` by whoever can actually receive the SMS.
  it('a second caller gets their own code, and neither call binds a vendor', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const otp = vi
      .spyOn(otpService, 'requestCode')
      .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

    const mine = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(1);

    const theirs = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348017654321',
    });
    // The response is still byte-identical — the non-oracle contract is unchanged by this, and
    // was never what the land-grab guard was for.
    expect(theirs.status).toBe(mine.status);
    expect(await theirs.text()).toBe(await mine.text());
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(2);

    const now = new Date();
    // And NEITHER call created an attempt row. Under GATE 3 nothing is bound to a vendor until
    // the OTP is verified, so the ops queue cannot be filled by callers who have proved nothing —
    // which is also why GATE 2's race cannot return through this endpoint.
    expect(
      await vendorClaimsRepo.findPendingByPhone(testDb, '+2348012345678', now),
    ).toBeUndefined();
    expect(
      await vendorClaimsRepo.findPendingByPhone(testDb, '+2348017654321', now),
    ).toBeUndefined();
  });

  it('400s a malformed phone rather than passing it downstream', async () => {
    const res = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: 'not-a-phone',
    });
    expect(res.status).toBe(400);
  });

  it('returns the minted code on a successful verify', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT KITCHEN',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: true,
      proof: 'phone_lookup',
      accountName: 'MAMA PUT KITCHEN',
    });

    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'food',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicCode: string; displayName: string };
    expect(body.publicCode).toMatch(/^AMNV-/);
    expect(body.displayName).toBe('MAMA PUT KITCHEN');
  });

  it('401s a wrong code and 409s an unproved account', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
    const bad = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '000000',
      category: 'food',
    });
    expect(bad.status).toBe(401);

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: false,
      reason: 'mismatch',
    });
    const unproved = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'food',
    });
    expect(unproved.status).toBe(409);
  });

  it('503s when the ownership partner is down', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: false,
      reason: 'partner_down',
    });
    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'food',
    });
    expect(res.status).toBe(503);
  });
  /**
   * The public page's identity string must come from the BANK, not from a payer's phone.
   *
   * `vendors.display_name` is seeded by the registry sweep from `vendor_observations.account_name`,
   * which traces straight back to `vendorResolvedName` on `POST /transactions/intent` — a
   * client-supplied field. SP-V1 could treat that as internal shadow data; SP-V3 renders it under
   * a "Verified on Amana" badge on the open internet, and nothing between the payer's app and that
   * page used to re-confirm the string against NIBSS.
   *
   * So the fixture is deliberately hostile: the vendor is promoted under a junk observed name and
   * the claim's NIBSS enquiry returns a different, real one. Asserting the junk name is ABSENT
   * matters as much as asserting the real one is present — a page that showed both would still be
   * publishing client-controlled text.
   */
  it('overwrites the observed display name with the NIBSS name from the claim enquiry', async () => {
    const OBSERVED_JUNK = 'ZZ-PAYER-SUPPLIED-JUNK-ZZ';
    const NIBSS_NAME = 'ADEYEMI GLOBAL VENTURES LTD';
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: OBSERVED_JUNK,
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: true,
      proof: 'phone_lookup',
      accountName: NIBSS_NAME,
    });

    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      bankCode: '058',
      accountNumber: '0123456789',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      code: '123456',
      category: 'food',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicCode: string; displayName: string };
    expect(body.displayName).toBe(NIBSS_NAME);

    // The row itself, not just the response: the response could be right while the persisted
    // value the page reads is still the junk.
    const row = await vendorsRepo.findById(testDb, v.id);
    expect(row?.displayName).toBe(NIBSS_NAME);

    // And the surface that actually faces the internet. Unauthenticated, exactly as a passer-by
    // reaches it.
    const pageRes = await app.request(`/v/${body.publicCode}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain(NIBSS_NAME);
    expect(html).not.toContain(OBSERVED_JUNK);
  });
});
