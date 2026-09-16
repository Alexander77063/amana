import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { supportVerifications } from '../../src/db/schema';
import { testDb, truncateAll } from '../helpers/test-db';

describe('support_verifications schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // The row is written whether or not the phone matched a customer. A table that only held rows
  // for real customers would itself be an enumeration oracle, and the "no such customer" path has
  // to be indistinguishable from an unanswered call.
  it('accepts a pending row with no resolved user', async () => {
    const [row] = await testDb
      .insert(supportVerifications)
      .values({
        adminUserId: null,
        phoneE164: '+2348010000001',
        userId: null,
        status: 'pending',
        rail: 'none',
        expiresAt: new Date(Date.now() + 180_000),
      })
      .returning();

    expect(row?.status).toBe('pending');
    expect(row?.userId).toBeNull();
    expect(row?.attempts).toBe(0);
    expect(row?.verifiedAt).toBeNull();
    expect(row?.sessionExpiresAt).toBeNull();
  });

  // These two assert the ENUM rejects the value, not merely that the statement threw. A bare
  // `.rejects.toThrow()` passed before this table existed at all — "relation does not exist" is
  // also a throw — so it proved nothing. Matching the message is what makes them real.
  it('rejects a status outside the enum', async () => {
    await expect(
      testDb.execute(
        sql`insert into support_verifications (phone_e164, status, rail, expires_at)
            values ('+2348010000002', 'bogus', 'none', now())`,
      ),
    ).rejects.toThrow(/invalid input value for enum support_verification_status/);
  });

  it('rejects a rail outside the enum', async () => {
    await expect(
      testDb.execute(
        sql`insert into support_verifications (phone_e164, status, rail, expires_at)
            values ('+2348010000003', 'pending', 'carrier-pigeon', now())`,
      ),
    ).rejects.toThrow(/invalid input value for enum support_verification_rail/);
  });
});
