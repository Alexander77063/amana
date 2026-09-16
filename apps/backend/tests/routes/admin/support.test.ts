import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { supportVerificationsRepo } from '../../../src/modules/support';
import { createServer } from '../../../src/server';
import { signedInAdmin } from '../../helpers/admin-session';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const app = createServer();

const start = (cookie: string, phone: string) =>
  app.request('/admin/support/verifications', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });

describe('POST /admin/support/verifications', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('accepts a start from support and never returns the decoys', async () => {
    const { cookie } = await signedInAdmin('v1@amana-ng.com', ['support']);

    const res = await start(cookie, '+2348013333333');
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.verificationId).toBeTruthy();
    expect(body.matchNumber).toBeGreaterThanOrEqual(10);
    expect(body.matchNumber).toBeLessThanOrEqual(99);
    // An operator holding all three numbers could read a WRONG one deliberately and learn from
    // which the customer taps. They get one number and nothing else.
    expect(body).not.toHaveProperty('decoys');
    expect(body).not.toHaveProperty('rail');
    expect(body).not.toHaveProperty('userId');
  });

  it('refuses an operator without support.verify', async () => {
    const { cookie } = await signedInAdmin('v2@amana-ng.com', ['ops']);

    expect((await start(cookie, '+2348014444444')).status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.request('/admin/support/verifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348014444445' }),
    });

    expect(res.status).toBe(401);
  });

  it('rejects a malformed phone at the edge', async () => {
    const { cookie } = await signedInAdmin('v5@amana-ng.com', ['support']);

    expect((await start(cookie, 'not-a-phone')).status).toBe(400);
  });

  // An explicit 429, not a silent 202: the no-oracle rule protects whether a CUSTOMER exists, and
  // an operator's own quota reveals nothing about that. Swallowing it would leave support watching
  // a verification that was never sent and blaming the customer for a limit staff hit.
  it('returns 429 rather than a silent 202 once the phone cap is reached', async () => {
    const { cookie } = await signedInAdmin('v3@amana-ng.com', ['support']);
    const phone = '+2348015555555';

    for (let i = 0; i < 5; i++) expect((await start(cookie, phone)).status).toBe(202);

    const capped = await start(cookie, phone);
    expect(capped.status).toBe(429);
    expect(capped.headers.get('retry-after')).toBeTruthy();
    expect((await capped.json()).error).toBe('rate_limited');
  });
});

describe('GET /admin/support/verifications/:id', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('reports status to the operator who started it', async () => {
    const { cookie } = await signedInAdmin('g1@amana-ng.com', ['support']);
    const started = await (await start(cookie, '+2348012222221')).json();

    const res = await app.request(`/admin/support/verifications/${started.verificationId}`, {
      headers: { cookie },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('pending');
    expect(body.expiresAt).toBeTruthy();
    expect(body.sessionExpiresAt).toBeNull();
  });

  it('is 404 for an operator who did not start it', async () => {
    const owner = await signedInAdmin('g2@amana-ng.com', ['support']);
    const other = await signedInAdmin('g3@amana-ng.com', ['support']);
    const started = await (await start(owner.cookie, '+2348012222222')).json();

    const res = await app.request(`/admin/support/verifications/${started.verificationId}`, {
      headers: { cookie: other.cookie },
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /admin/support/verifications/:id/code', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('verifies on the code the customer read out', async () => {
    const { cookie, adminUserId } = await signedInAdmin('k1@amana-ng.com', ['support']);
    const customer = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    // Start through the service so the stored hash is real, then confirm through the route.
    const { hashCode } = await import('../../../src/modules/support');
    const row = await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: customer.phone,
      userId: customer.id,
      rail: 'sms',
      matchNumber: null,
      codeHash: hashCode('654321'),
      expiresAt: new Date(Date.now() + 180_000),
    });

    const res = await app.request(`/admin/support/verifications/${row.id}/code`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: '654321' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('verified');
  });

  it('rejects a code that is not six digits at the edge', async () => {
    const { cookie, adminUserId } = await signedInAdmin('k2@amana-ng.com', ['support']);
    const row = await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: '+2348012222229',
      userId: null,
      rail: 'none',
      matchNumber: null,
      codeHash: null,
      expiresAt: new Date(Date.now() + 180_000),
    });

    const res = await app.request(`/admin/support/verifications/${row.id}/code`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: '12' }),
    });

    expect(res.status).toBe(400);
  });
});
