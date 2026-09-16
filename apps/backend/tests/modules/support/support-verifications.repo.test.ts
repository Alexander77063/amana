import { beforeEach, describe, expect, it } from 'vitest';
import { supportVerificationsRepo } from '../../../src/modules/support';
import { signedInAdmin } from '../../helpers/admin-session';
import { testDb, truncateAll } from '../../helpers/test-db';

const in3Min = () => new Date(Date.now() + 180_000);

const aStart = (adminUserId: string, phoneE164: string) =>
  supportVerificationsRepo.create(testDb, {
    adminUserId,
    phoneE164,
    userId: null,
    rail: 'none',
    matchNumber: null,
    codeHash: null,
    expiresAt: in3Min(),
  });

describe('supportVerificationsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('counts starts by one operator inside the window and ignores older ones', async () => {
    const { adminUserId } = await signedInAdmin('support1@amana-ng.com', ['support']);
    await aStart(adminUserId, '+2348010000001');

    const sinceNow = await supportVerificationsRepo.countByOperatorSince(
      testDb,
      adminUserId,
      new Date(Date.now() - 60_000),
    );
    const sinceFuture = await supportVerificationsRepo.countByOperatorSince(
      testDb,
      adminUserId,
      new Date(Date.now() + 60_000),
    );

    expect(sinceNow).toBe(1);
    expect(sinceFuture).toBe(0);
  });

  // The per-phone cap is counted across ALL operators on purpose: a limit one member of staff can
  // walk around by asking a colleague is not a limit.
  it('counts starts against one phone regardless of which operator made them', async () => {
    const a = await signedInAdmin('support2@amana-ng.com', ['support']);
    const b = await signedInAdmin('support3@amana-ng.com', ['support']);
    for (const operator of [a, b]) {
      await aStart(operator.adminUserId, '+2348010000009');
    }

    const count = await supportVerificationsRepo.countByPhoneSince(
      testDb,
      '+2348010000009',
      new Date(Date.now() - 60_000),
    );

    expect(count).toBe(2);
  });

  it('does not count starts aimed at a different phone', async () => {
    const { adminUserId } = await signedInAdmin('support5@amana-ng.com', ['support']);
    await aStart(adminUserId, '+2348010000011');

    const count = await supportVerificationsRepo.countByPhoneSince(
      testDb,
      '+2348010000012',
      new Date(Date.now() - 60_000),
    );

    expect(count).toBe(0);
  });

  it('increments attempts and returns the new value', async () => {
    const { adminUserId } = await signedInAdmin('support4@amana-ng.com', ['support']);
    const row = await supportVerificationsRepo.create(testDb, {
      adminUserId,
      phoneE164: '+2348010000003',
      userId: null,
      rail: 'sms',
      matchNumber: null,
      codeHash: 'hashed',
      expiresAt: in3Min(),
    });

    expect(await supportVerificationsRepo.incrementAttempts(testDb, row.id)).toBe(1);
    expect(await supportVerificationsRepo.incrementAttempts(testDb, row.id)).toBe(2);
  });

  it('finds a row by id and returns null for one that does not exist', async () => {
    const { adminUserId } = await signedInAdmin('support6@amana-ng.com', ['support']);
    const row = await aStart(adminUserId, '+2348010000004');

    expect((await supportVerificationsRepo.findById(testDb, row.id))?.id).toBe(row.id);
    expect(
      await supportVerificationsRepo.findById(testDb, '00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
  });

  // The `status = 'pending'` predicate on the update is a concurrency guard: two responses racing
  // must not both verify, and a denied row must never be resurrected.
  it('verifies only a pending row, and never twice', async () => {
    const { adminUserId } = await signedInAdmin('support7@amana-ng.com', ['support']);
    const row = await aStart(adminUserId, '+2348010000005');
    const sessionEnd = new Date(Date.now() + 900_000);

    const first = await supportVerificationsRepo.markVerified(testDb, row.id, sessionEnd);
    const second = await supportVerificationsRepo.markVerified(testDb, row.id, sessionEnd);

    expect(first?.status).toBe('verified');
    expect(first?.verifiedAt).not.toBeNull();
    expect(second).toBeNull();
  });

  it('refuses to deny a row that has already verified', async () => {
    const { adminUserId } = await signedInAdmin('support8@amana-ng.com', ['support']);
    const row = await aStart(adminUserId, '+2348010000006');
    await supportVerificationsRepo.markVerified(testDb, row.id, new Date(Date.now() + 900_000));

    expect(await supportVerificationsRepo.markDenied(testDb, row.id)).toBeNull();
  });
});
