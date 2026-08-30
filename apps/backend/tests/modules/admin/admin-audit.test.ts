// apps/backend/tests/modules/admin/admin-audit.test.ts
//
// Attribution is the single thing this sub-plan exists to buy: `audit_log.actorUserId` is null on
// every ops write today, so the trail records that SOMEBODY transferred a merchant's bank
// account. Task 1 cannot fix the 13 ops endpoints (that is Task 4) but it must land the column
// they will write to, and it must already use it for the one admin action that exists: signing in.
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../../src/db/schema';
import { adminIdentityService } from '../../../src/modules/admin/admin-identity.service';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { stubOidcProvider } from '../../helpers/oidc-stub';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('admin audit attribution', () => {
  beforeEach(async () => {
    await truncateAll();
    await adminIdentityService.ensureBootstrapOwner(testDb);
  });

  it('records a successful sign-in against the admin who made it', async () => {
    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);
    const result = await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'code',
    });
    if (result.kind !== 'signed_in') throw new Error('expected sign-in');

    const rows = await auditRepo.listByAction(testDb, 'admin.signed_in');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.actorAdminUserId).toBe(result.adminUser.id);
    // Staff are not customers: the customer actor column stays null, which is how a reader tells
    // an operator's action from an account holder's.
    expect(row?.actorUserId).toBeNull();
    expect(row?.actorKind).toBe('ops');
  });

  it('records a refused sign-in, naming the admin when there is one', async () => {
    const owner = await adminUsersRepo.findByEmail(testDb, 'david@amana-ng.com');
    if (!owner) throw new Error('expected the seeded owner');
    await adminUsersRepo.setStatus(testDb, owner.id, 'suspended');

    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);
    await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'code',
    });

    const rows = await auditRepo.listByAction(testDb, 'admin.sign_in_denied');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorAdminUserId).toBe(owner.id);
    expect(rows[0]?.payloadJson).toMatchObject({ reason: 'suspended' });
  });

  it('records a refused stranger without storing their personal address', async () => {
    // A denial by an address outside the Workspace belongs to someone who is not staff and not a
    // customer. The event is worth keeping — it is a security event on the surface that can
    // suspend businesses — but their personal email is not ours to file, so only the domain is.
    const provider = stubOidcProvider({
      identity: { email: 'someone@gmail.com', hostedDomain: null },
    });
    const started = await adminIdentityService.startLogin(testDb, provider);
    await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'code',
    });

    const rows = await auditRepo.listByAction(testDb, 'admin.sign_in_denied');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorAdminUserId).toBeNull();
    expect(rows[0]?.payloadJson).toMatchObject({
      reason: 'outside_workspace_domain',
      emailDomain: 'gmail.com',
    });
    expect(JSON.stringify(rows[0]?.payloadJson)).not.toContain('someone@gmail.com');
  });

  it('refuses at the database to name two different kinds of actor on one event', async () => {
    // The two actor columns are alternatives, never both. A row claiming a customer AND an
    // operator did one thing is not an audit trail, it is an ambiguity, and the constraint has to
    // live in the database because `audit_log` is append-only — a bad row can never be repaired.
    const owner = await adminUsersRepo.findByEmail(testDb, 'david@amana-ng.com');
    if (!owner) throw new Error('expected the seeded owner');
    const customer = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });

    // A REAL customer id, so the only thing left to reject the row is the constraint under test.
    // With a fabricated id the insert would fail on the foreign key and the test would pass
    // while proving nothing.
    await expect(
      testDb.insert(auditLog).values({
        actorKind: 'ops',
        actorUserId: customer.id,
        actorAdminUserId: owner.id,
        action: 'admin.impossible',
        subjectKind: 'admin_user',
        subjectId: owner.id,
        payloadJson: {},
      }),
    ).rejects.toThrow(/audit_log_single_actor/);
  });

  it('still accepts an event with no actor at all', async () => {
    // The constraint is `<= 1`, not `= 1`. Cron sweeps and Anchor webhooks are actorless by
    // nature and must keep writing — a stricter constraint would have taken the ledger's
    // settlement trail down with it.
    await expect(
      auditRepo.append(testDb, {
        actorKind: 'system',
        action: 'admin.actorless',
        subjectKind: 'admin_user',
        subjectId: '00000000-0000-0000-0000-000000000002',
        payloadJson: {},
      }),
    ).resolves.toBeTruthy();
  });
});
