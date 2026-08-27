import { beforeEach, describe, expect, it, vi } from 'vitest';
import { otpService } from '../../src/modules/auth/otp.service';
import { pairingService } from '../../src/modules/auth/pairing.service';
import {
  AGENT_TERMS_VERSION,
  PRINCIPAL_TERMS_VERSION,
  userConsentService,
} from '../../src/modules/identity/user-consent.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer();

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * NDPA 2023 lawful basis at sign-up.
 *
 * A user row created with no recorded acceptance is a person whose BVN, NIN and spending we are
 * processing with nothing to point at. Both roles are gated, and both are gated BEFORE the row is
 * written — a failed acceptance must not leave a half-made user behind.
 */
describe('POST /auth/otp/verify — terms at sign-up', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'verified' });
  });

  const phone = () => factories.phone();

  it('refuses a principal sign-up with no accepted terms', async () => {
    const res = await post('/auth/otp/verify', {
      phone: phone(),
      code: '123456',
      nin: factories.nin(),
      bvn: factories.bvn(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'terms_not_accepted',
      requiredVersion: PRINCIPAL_TERMS_VERSION,
    });
  });

  it('refuses a principal sign-up against a stale version', async () => {
    const res = await post('/auth/otp/verify', {
      phone: phone(),
      code: '123456',
      nin: factories.nin(),
      bvn: factories.bvn(),
      acceptedTermsVersion: 'v0-ancient',
    });
    expect(res.status).toBe(400);
  });

  it('creates NO user when the terms are refused', async () => {
    const p = phone();
    await post('/auth/otp/verify', {
      phone: p,
      code: '123456',
      nin: factories.nin(),
      bvn: factories.bvn(),
    });
    expect(await usersRepo.findByPhone(testDb, p)).toBeUndefined();
  });

  it('creates the principal and records the acceptance when terms are accepted', async () => {
    const p = phone();
    const res = await post('/auth/otp/verify', {
      phone: p,
      code: '123456',
      nin: factories.nin(),
      bvn: factories.bvn(),
      acceptedTermsVersion: PRINCIPAL_TERMS_VERSION,
    });
    expect(res.status).toBe(200);

    const user = await usersRepo.findByPhone(testDb, p);
    if (!user) throw new Error('user not created');
    const consent = await userConsentService.latest(testDb, user.id);
    expect(consent).toMatchObject({
      granted: true,
      termsVersion: PRINCIPAL_TERMS_VERSION,
      source: 'signup',
    });
    expect(await userConsentService.hasAcceptedCurrent(testDb, user.id, 'principal')).toBe(true);
  });

  it('refuses an agent sign-up with no accepted terms, and consumes no pairing code', async () => {
    const consume = vi.spyOn(pairingService, 'consume');
    const res = await post('/auth/otp/verify', {
      phone: phone(),
      code: '123456',
      nin: factories.nin(),
      pairingCode: 'PAIR-WHATEVER',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'terms_not_accepted',
      requiredVersion: AGENT_TERMS_VERSION,
    });
    // The gate sits ahead of the pairing consume, so a refused sign-up does not burn a one-use code.
    expect(consume).not.toHaveBeenCalled();
  });

  // An existing user signing in is not re-prompted; acceptance happened at sign-up. Pinned because
  // requiring it on every sign-in would lock out every user the moment a version is bumped.
  it('does not require the field for an ordinary sign-in', async () => {
    const p = phone();
    await post('/auth/otp/verify', {
      phone: p,
      code: '123456',
      nin: factories.nin(),
      bvn: factories.bvn(),
      acceptedTermsVersion: PRINCIPAL_TERMS_VERSION,
    });

    const again = await post('/auth/otp/verify', { phone: p, code: '123456' });
    expect(again.status).toBe(200);
  });
});
