// apps/backend/tests/routes/retailers.audit.test.ts
//
// A gap found while building A1 Task 2: the retailer ops endpoints wrote NO audit row at all.
// Not "a row with a null actor" — no row. Approving a retailer admits a business to the
// marketplace and suspending one cuts off its income, and neither left any trace that it had
// happened, by anyone, ever.
//
// That was a strictly worse problem than the missing attribution this sub-plan set out to fix.
// Task 2 added the events; Task 4 cut these routes over to staff sessions, so they now name the
// operator as well as the action.
import { beforeEach, describe, expect, it } from 'vitest';
import { auditRepo } from '../../src/modules/audit/audit.repo';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { testDb, truncateAll } from '../helpers/test-db';

let HEADERS: Record<string, string>;
let opsAdminUserId: string;

const applyBody = {
  businessName: 'Ada Salon',
  payoutBankCode: '000014',
  payoutAccountNumber: '0123456789',
};

const app = createServer();

beforeEach(async () => {
  await truncateAll();
  const { cookie, adminUserId } = await signedInAdmin('ops@amana-ng.com', ['ops']);
  HEADERS = { cookie, 'content-type': 'application/json' };
  opsAdminUserId = adminUserId;
});

async function applyRetailer(): Promise<string> {
  const res = await app.request('/retailers', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(applyBody),
  });
  return (await res.json()).id;
}

describe('retailer ops actions are audited', () => {
  it('records an application', async () => {
    const id = await applyRetailer();

    const rows = await auditRepo.listByAction(testDb, 'retailer.applied');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(id);
    expect(rows[0]?.subjectKind).toBe('retailer');
    expect(rows[0]?.actorKind).toBe('ops');
  });

  it('records an approval, naming the retailer it admitted', async () => {
    const id = await applyRetailer();
    await app.request(`/retailers/${id}/approve`, { method: 'POST', headers: HEADERS });

    const rows = await auditRepo.listByAction(testDb, 'retailer.approved');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(id);
  });

  it('records a suspension — the action that cuts off a business', async () => {
    const id = await applyRetailer();
    await app.request(`/retailers/${id}/suspend`, { method: 'POST', headers: HEADERS });

    const rows = await auditRepo.listByAction(testDb, 'retailer.suspended');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(id);
  });

  it('NAMES the operator — the gap this sub-plan existed to close', async () => {
    // This test previously asserted the opposite, with a note saying "if this fails because
    // actorAdminUserId is now populated, that is Task 4 landing". Task 4 landed.
    //
    // Suspending a retailer cuts off a business's income. Until now the trail could say only that
    // an operator did it. It can now say which one, and `actorUserId` stays null because staff are
    // not customers — the two actor kinds remain distinguishable.
    const id = await applyRetailer();
    await app.request(`/retailers/${id}/approve`, { method: 'POST', headers: HEADERS });

    const rows = await auditRepo.listByAction(testDb, 'retailer.approved');
    expect(rows[0]?.actorAdminUserId).toBe(opsAdminUserId);
    expect(rows[0]?.actorUserId).toBeNull();
    expect(rows[0]?.actorKind).toBe('ops');
  });
});
