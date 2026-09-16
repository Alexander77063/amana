import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import {
  SupportSessionError,
  hashCode,
  supportVerificationService,
  supportVerificationsRepo,
} from '../../../src/modules/support';
import { signedInAdmin } from '../../helpers/admin-session';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

/**
 * `support_verifications.user_id` has a foreign key to `users.id`, so a random UUID here is a
 * constraint violation, not a convenient stand-in. Seed a real customer.
 */
const seedPrincipal = () =>
  usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });

const startPush = (adminUserId: string, userId: string, expiresAt?: Date) =>
  supportVerificationsRepo.create(testDb, {
    adminUserId,
    phoneE164: factories.phone(),
    userId,
    rail: 'push',
    matchNumber: 42,
    codeHash: null,
    expiresAt: expiresAt ?? new Date(Date.now() + 180_000),
  });

const startSms = (adminUserId: string, userId: string, code: string) =>
  supportVerificationsRepo.create(testDb, {
    adminUserId,
    phoneE164: factories.phone(),
    userId,
    rail: 'sms',
    matchNumber: null,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + 180_000),
  });

describe('responding to a verification', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('verifies when the customer taps the number the operator read', async () => {
    const { adminUserId } = await signedInAdmin('r1@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await startPush(adminUserId, userId);

    const outcome = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 42,
    });

    expect(outcome).toBe('verified');
    const after = await supportVerificationsRepo.findById(testDb, row.id);
    expect(after?.sessionExpiresAt).not.toBeNull();
  });

  // A one-in-three guess must not be retryable, or number matching is worth a third of nothing.
  it('denies immediately on a wrong tap, and a later right tap cannot rescue it', async () => {
    const { adminUserId } = await signedInAdmin('r2@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await startPush(adminUserId, userId);

    const first = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 17,
    });
    const second = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 42,
    });

    expect(first).toBe('denied');
    expect(second).toBe('denied');
  });

  // "not_found", never "wrong customer" — the caller must not learn that the id exists.
  it('refuses a response from a different customer than the one it was sent to', async () => {
    const { adminUserId } = await signedInAdmin('r3@amana-ng.com', ['support']);
    const addressee = await seedPrincipal();
    const someoneElse = await seedPrincipal();
    const row = await startPush(adminUserId, addressee.id);

    const outcome = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId: someoneElse.id,
      chosenNumber: 42,
    });

    expect(outcome).toBe('not_found');
  });

  it('expires rather than verifying once the pending window has passed', async () => {
    const { adminUserId } = await signedInAdmin('r4@amana-ng.com', ['support']);
    const { id: userId } = await seedPrincipal();
    const row = await startPush(adminUserId, userId, new Date(Date.now() - 1000));

    const outcome = await supportVerificationService.respondFromCustomer(testDb, {
      verificationId: row.id,
      userId,
      chosenNumber: 42,
    });

    expect(outcome).toBe('expired');
  });

  describe('confirmCode', () => {
    it('verifies when the operator types the code the customer read out', async () => {
      const { adminUserId } = await signedInAdmin('c1@amana-ng.com', ['support']);
      const { id: userId } = await seedPrincipal();
      const row = await startSms(adminUserId, userId, '123456');

      const outcome = await supportVerificationService.confirmCode(testDb, {
        verificationId: row.id,
        actorAdminUserId: adminUserId,
        code: '123456',
      });

      expect(outcome).toBe('verified');
    });

    // Three attempts, unlike push's one: a code read aloud over a bad line is genuinely misheard,
    // where a tap is not.
    it('allows two wrong codes and denies on the third', async () => {
      const { adminUserId } = await signedInAdmin('c2@amana-ng.com', ['support']);
      const { id: userId } = await seedPrincipal();
      const row = await startSms(adminUserId, userId, '123456');
      const wrong = () =>
        supportVerificationService.confirmCode(testDb, {
          verificationId: row.id,
          actorAdminUserId: adminUserId,
          code: '000000',
        });

      expect(await wrong()).toBe('denied');
      expect(await wrong()).toBe('denied');
      expect(await wrong()).toBe('denied');

      // After the third the row itself is denied, so even the RIGHT code no longer works.
      expect(
        await supportVerificationService.confirmCode(testDb, {
          verificationId: row.id,
          actorAdminUserId: adminUserId,
          code: '123456',
        }),
      ).toBe('denied');
    });

    it('refuses a code typed by an operator who did not start the verification', async () => {
      const owner = await signedInAdmin('c3@amana-ng.com', ['support']);
      const other = await signedInAdmin('c4@amana-ng.com', ['support']);
      const { id: userId } = await seedPrincipal();
      const row = await startSms(owner.adminUserId, userId, '123456');

      const outcome = await supportVerificationService.confirmCode(testDb, {
        verificationId: row.id,
        actorAdminUserId: other.adminUserId,
        code: '123456',
      });

      expect(outcome).toBe('not_found');
    });
  });

  describe('requireLiveSession', () => {
    it('returns the row while the session is live', async () => {
      const { adminUserId } = await signedInAdmin('q1@amana-ng.com', ['support']);
      const { id: userId } = await seedPrincipal();
      const row = await startPush(adminUserId, userId);
      await supportVerificationService.respondFromCustomer(testDb, {
        verificationId: row.id,
        userId,
        chosenNumber: 42,
      });

      const live = await supportVerificationService.requireLiveSession(testDb, {
        verificationId: row.id,
        actorAdminUserId: adminUserId,
      });

      expect(live.id).toBe(row.id);
      expect(live.userId).toBe(userId);
    });

    it('throws for a verification that was never verified', async () => {
      const { adminUserId } = await signedInAdmin('q2@amana-ng.com', ['support']);
      const { id: userId } = await seedPrincipal();
      const row = await startPush(adminUserId, userId);

      await expect(
        supportVerificationService.requireLiveSession(testDb, {
          verificationId: row.id,
          actorAdminUserId: adminUserId,
        }),
      ).rejects.toBeInstanceOf(SupportSessionError);
    });

    it('throws once the session window has passed', async () => {
      const { adminUserId } = await signedInAdmin('q3@amana-ng.com', ['support']);
      const { id: userId } = await seedPrincipal();
      const row = await startPush(adminUserId, userId);
      await supportVerificationsRepo.markVerified(testDb, row.id, new Date(Date.now() - 1000));

      await expect(
        supportVerificationService.requireLiveSession(testDb, {
          verificationId: row.id,
          actorAdminUserId: adminUserId,
        }),
      ).rejects.toBeInstanceOf(SupportSessionError);
    });

    // A verified session is not a token a second member of staff can pick up.
    it('throws for an operator who did not start the verification', async () => {
      const owner = await signedInAdmin('q4@amana-ng.com', ['support']);
      const other = await signedInAdmin('q5@amana-ng.com', ['support']);
      const { id: userId } = await seedPrincipal();
      const row = await startPush(owner.adminUserId, userId);
      await supportVerificationsRepo.markVerified(testDb, row.id, new Date(Date.now() + 900_000));

      await expect(
        supportVerificationService.requireLiveSession(testDb, {
          verificationId: row.id,
          actorAdminUserId: other.adminUserId,
        }),
      ).rejects.toBeInstanceOf(SupportSessionError);
    });
  });
});
