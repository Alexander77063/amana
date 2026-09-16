import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { supportVerificationService, supportVerificationsRepo } from '../../../src/modules/support';
import { signedInAdmin } from '../../helpers/admin-session';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const seedUser = (role: 'principal' | 'agent' | 'retailer', phone: string) =>
  usersRepo.insert(testDb, {
    role,
    phone,
    nin: factories.nin(),
    kycTier: role === 'principal' ? '2' : '1',
    ...(role === 'principal' ? { bvn: factories.bvn() } : {}),
  });

describe('supportVerificationService.start', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // The whole security property in one test: a stranger's number must produce the same shape,
  // and nothing may be dispatched.
  it('answers identically for a number that matches nobody', async () => {
    const { adminUserId } = await signedInAdmin('s1@amana-ng.com', ['support']);

    const result = await supportVerificationService.start(testDb, {
      actorAdminUserId: adminUserId,
      phoneE164: '+2348019999999',
    });

    if ('capped' in result) throw new Error('unexpected cap');
    expect(result.verificationId).toBeTruthy();
    expect(result.matchNumber).toBeGreaterThanOrEqual(10);
    expect(result.matchNumber).toBeLessThanOrEqual(99);
    expect(result.decoys).toHaveLength(2);

    const row = await supportVerificationsRepo.findById(testDb, result.verificationId);
    expect(row?.userId).toBeNull();
    expect(row?.rail).toBe('none');
    expect(row?.codeHash).toBeNull();
  });

  // Bounded at 15 rather than 30 deliberately: one operator may only start 20 in an hour, and a
  // loop that trips its own cap tests the cap, not the numbers.
  it('never repeats a number among the match and its decoys', async () => {
    const { adminUserId } = await signedInAdmin('s2@amana-ng.com', ['support']);
    for (let i = 0; i < 15; i++) {
      const result = await supportVerificationService.start(testDb, {
        actorAdminUserId: adminUserId,
        phoneE164: `+23480188${String(10000 + i)}`,
      });
      if ('capped' in result) throw new Error('unexpected cap');
      expect(new Set([result.matchNumber, ...result.decoys]).size).toBe(3);
    }
  });

  it('uses the sms rail for a real customer with no device token, and hashes the code', async () => {
    const { adminUserId } = await signedInAdmin('s5@amana-ng.com', ['support']);
    const phone = factories.phone();
    await seedUser('principal', phone);

    const result = await supportVerificationService.start(testDb, {
      actorAdminUserId: adminUserId,
      phoneE164: phone,
    });

    if ('capped' in result) throw new Error('unexpected cap');
    const row = await supportVerificationsRepo.findById(testDb, result.verificationId);
    expect(row?.rail).toBe('sms');
    expect(row?.userId).not.toBeNull();
    // Hashed, never the code itself — a readable code in the table would let anyone with database
    // access pass verification without the customer.
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Retailers are explicitly out of scope: a different relationship, their own portal, and a read
  // model with different masking rules. They must look exactly like a stranger.
  it('treats a retailer as no match at all', async () => {
    const { adminUserId } = await signedInAdmin('s6@amana-ng.com', ['support']);
    const phone = factories.phone();
    await seedUser('retailer', phone);

    const result = await supportVerificationService.start(testDb, {
      actorAdminUserId: adminUserId,
      phoneE164: phone,
    });

    if ('capped' in result) throw new Error('unexpected cap');
    const row = await supportVerificationsRepo.findById(testDb, result.verificationId);
    expect(row?.userId).toBeNull();
    expect(row?.rail).toBe('none');
  });

  it('caps one phone across two different operators', async () => {
    const a = await signedInAdmin('s3@amana-ng.com', ['support']);
    const b = await signedInAdmin('s4@amana-ng.com', ['support']);
    const phone = '+2348017777777';

    for (let i = 0; i < 5; i++) {
      const r = await supportVerificationService.start(testDb, {
        actorAdminUserId: a.adminUserId,
        phoneE164: phone,
      });
      expect('capped' in r).toBe(false);
    }

    const sixth = await supportVerificationService.start(testDb, {
      actorAdminUserId: b.adminUserId,
      phoneE164: phone,
    });

    expect('capped' in sixth).toBe(true);
  });

  it('caps one operator across many different phones', async () => {
    const { adminUserId } = await signedInAdmin('s7@amana-ng.com', ['support']);

    for (let i = 0; i < 20; i++) {
      const r = await supportVerificationService.start(testDb, {
        actorAdminUserId: adminUserId,
        phoneE164: `+23480177${String(20000 + i)}`,
      });
      expect('capped' in r).toBe(false);
    }

    const twentyFirst = await supportVerificationService.start(testDb, {
      actorAdminUserId: adminUserId,
      phoneE164: '+2348017799999',
    });

    expect('capped' in twentyFirst).toBe(true);
  });

  it('writes an audit row that does not record whether the phone matched', async () => {
    const { adminUserId } = await signedInAdmin('s8@amana-ng.com', ['support']);
    const result = await supportVerificationService.start(testDb, {
      actorAdminUserId: adminUserId,
      phoneE164: '+2348016543210',
    });
    if ('capped' in result) throw new Error('unexpected cap');

    const { auditRepo } = await import('../../../src/modules/audit');
    const entries = await auditRepo.listBySubject(testDb, result.verificationId);
    const started = entries.find((e) => e.action === 'support.verification.started');

    expect(started?.actorAdminUserId).toBe(adminUserId);
    // The audit log must not become the oracle the API refuses to be.
    expect(JSON.stringify(started?.payloadJson)).not.toMatch(/matched|userId|rail/i);
  });
});
