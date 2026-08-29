// apps/backend/tests/modules/admin/admin-role-grants.repo.test.ts
//
// Roles are an append-only LOG, not a column. A revocation is a row. The current set of roles is a
// fold over that log, and the fold orders on `seq` alone — never on a timestamp. `vendor_consents`
// learned that the hard way: a grant and its revocation can share a `recorded_at`, and once they
// do, tie-breaking on a random uuid decides which one wins by chance. That table passed its tests
// once and failed them on the next run. These tests exist so this one cannot repeat it.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminRoleGrantsRepo } from '../../../src/modules/admin/admin-role-grants.repo';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { testDb, truncateAll } from '../../helpers/test-db';

async function anAdmin(email: string) {
  const row = await adminUsersRepo.insertIfAbsent(testDb, {
    email,
    provisioningSource: 'admin',
  });
  if (!row) throw new Error('expected a new admin');
  return row;
}

describe('adminRoleGrantsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('a newly created admin holds no roles at all', async () => {
    // Invariant 4, least privilege by default: existing is not the same as being able to do
    // anything. There is no default role and no implicit one.
    const admin = await anAdmin('nobody@amana-ng.com');
    expect(await adminRoleGrantsRepo.currentRoles(testDb, admin.id)).toEqual([]);
  });

  it('folds a grant into the current roles', async () => {
    const admin = await anAdmin('ops1@amana-ng.com');
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role: 'ops',
      granted: true,
      grantedByAdminUserId: null,
      source: 'config',
    });

    expect(await adminRoleGrantsRepo.currentRoles(testDb, admin.id)).toEqual(['ops']);
  });

  it('folds a revocation as a new row, leaving the grant in the log', async () => {
    const admin = await anAdmin('ops2@amana-ng.com');
    const granter = await anAdmin('boss@amana-ng.com');
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role: 'ops',
      granted: true,
      grantedByAdminUserId: granter.id,
      source: 'admin',
    });
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role: 'ops',
      granted: false,
      grantedByAdminUserId: granter.id,
      source: 'admin',
    });

    expect(await adminRoleGrantsRepo.currentRoles(testDb, admin.id)).toEqual([]);
    // The history survives: "did this person ever hold ops, and who gave it to them" stays
    // answerable after the revocation. An UPDATE would have destroyed exactly that.
    const history = await adminRoleGrantsRepo.listForAdmin(testDb, admin.id);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.granted)).toEqual([true, false]);
  });

  it('re-granting after a revocation restores the role', async () => {
    const admin = await anAdmin('ops3@amana-ng.com');
    for (const granted of [true, false, true]) {
      await adminRoleGrantsRepo.append(testDb, {
        adminUserId: admin.id,
        role: 'ops',
        granted,
        grantedByAdminUserId: null,
        source: 'config',
      });
    }
    expect(await adminRoleGrantsRepo.currentRoles(testDb, admin.id)).toEqual(['ops']);
  });

  it('orders on seq, not on a timestamp — even when the clock disagrees with the order', async () => {
    // THE test this file exists for, and it is deliberately built so that a timestamp sort gives
    // the OPPOSITE answer rather than merely an arbitrary one. Identical timestamps would not do
    // that: Postgres tends to return them in heap order, so a wrong fold would pass by luck.
    //
    // Here the revocation is appended second but carries an EARLIER timestamp — a clock that went
    // backwards (NTP correction, a caller-supplied `now`, two instances that disagree). Ordering
    // by `recorded_at` therefore concludes the admin still holds `ops`; ordering by `seq`
    // correctly concludes the role was taken away. One of those answers hands someone access they
    // were supposed to have lost.
    const admin = await anAdmin('tie@amana-ng.com');
    const later = new Date();
    const earlier = new Date(later.getTime() - 60 * 60 * 1000);

    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role: 'ops',
      granted: true,
      grantedByAdminUserId: null,
      source: 'config',
      recordedAt: later,
    });
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role: 'ops',
      granted: false,
      grantedByAdminUserId: null,
      source: 'config',
      recordedAt: earlier,
    });

    expect(await adminRoleGrantsRepo.currentRoles(testDb, admin.id)).toEqual([]);
  });

  it('keeps roles independent of each other', async () => {
    const admin = await anAdmin('multi@amana-ng.com');
    for (const role of ['ops', 'auditor'] as const) {
      await adminRoleGrantsRepo.append(testDb, {
        adminUserId: admin.id,
        role,
        granted: true,
        grantedByAdminUserId: null,
        source: 'config',
      });
    }
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role: 'ops',
      granted: false,
      grantedByAdminUserId: null,
      source: 'config',
    });

    // Revoking one role must not disturb another. The fold is per (admin, role), not per admin.
    expect(await adminRoleGrantsRepo.currentRoles(testDb, admin.id)).toEqual(['auditor']);
  });

  it('keeps admins independent of each other', async () => {
    const a = await anAdmin('a@amana-ng.com');
    const b = await anAdmin('b@amana-ng.com');
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: a.id,
      role: 'ops',
      granted: true,
      grantedByAdminUserId: null,
      source: 'config',
    });

    expect(await adminRoleGrantsRepo.currentRoles(testDb, b.id)).toEqual([]);
  });
});
