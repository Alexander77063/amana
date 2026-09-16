import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { supportVerificationsRepo } from '../../src/modules/support';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer();

// `bearerHeaders` takes a UserRow; it does not create one. The FK on user_id is real.
const seedPrincipal = () =>
  usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });

const pendingPush = (adminUserId: string, userId: string) =>
  supportVerificationsRepo.create(testDb, {
    adminUserId,
    phoneE164: factories.phone(),
    userId,
    rail: 'push',
    matchNumber: 42,
    codeHash: null,
    expiresAt: new Date(Date.now() + 180_000),
  });

describe('POST /support/verifications/:id/respond', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('verifies when the signed-in customer taps the right number', async () => {
    const { adminUserId } = await signedInAdmin('cr1@amana-ng.com', ['support']);
    const customer = await seedPrincipal();
    const row = await pendingPush(adminUserId, customer.id);

    const res = await app.request(`/support/verifications/${row.id}/respond`, {
      method: 'POST',
      headers: await bearerHeaders(customer),
      body: JSON.stringify({ chosenNumber: 42 }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('verified');
  });

  it('denies on the wrong number', async () => {
    const { adminUserId } = await signedInAdmin('cr2@amana-ng.com', ['support']);
    const customer = await seedPrincipal();
    const row = await pendingPush(adminUserId, customer.id);

    const res = await app.request(`/support/verifications/${row.id}/respond`, {
      method: 'POST',
      headers: await bearerHeaders(customer),
      body: JSON.stringify({ chosenNumber: 17 }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('denied');
  });

  it('rejects an unauthenticated response', async () => {
    const res = await app.request(
      `/support/verifications/00000000-0000-0000-0000-000000000000/respond`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosenNumber: 42 }),
      },
    );

    expect(res.status).toBe(401);
  });

  // 200 even for a verification that is not theirs (or does not exist). A 404 would let a customer
  // probe which verification ids are real.
  it('answers 200 with not_found for a verification belonging to someone else', async () => {
    const { adminUserId } = await signedInAdmin('cr3@amana-ng.com', ['support']);
    const addressee = await seedPrincipal();
    const someoneElse = await seedPrincipal();
    const row = await pendingPush(adminUserId, addressee.id);

    const res = await app.request(`/support/verifications/${row.id}/respond`, {
      method: 'POST',
      headers: await bearerHeaders(someoneElse),
      body: JSON.stringify({ chosenNumber: 42 }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('not_found');
  });

  it('rejects a number outside the two-digit range at the edge', async () => {
    const { adminUserId } = await signedInAdmin('cr4@amana-ng.com', ['support']);
    const customer = await seedPrincipal();
    const row = await pendingPush(adminUserId, customer.id);

    const res = await app.request(`/support/verifications/${row.id}/respond`, {
      method: 'POST',
      headers: await bearerHeaders(customer),
      body: JSON.stringify({ chosenNumber: 5 }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed verification id at the edge', async () => {
    const customer = await seedPrincipal();

    const res = await app.request('/support/verifications/not-a-uuid/respond', {
      method: 'POST',
      headers: await bearerHeaders(customer),
      body: JSON.stringify({ chosenNumber: 42 }),
    });

    expect(res.status).toBe(400);
  });
});
