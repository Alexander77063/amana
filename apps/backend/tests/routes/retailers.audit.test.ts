// apps/backend/tests/routes/retailers.audit.test.ts
//
// A gap found while building A1 Task 2: the retailer ops endpoints wrote NO audit row at all.
// Not "a row with a null actor" — no row. Approving a retailer admits a business to the
// marketplace and suspending one cuts off its income, and neither left any trace that it had
// happened, by anyone, ever.
//
// That is a strictly worse problem than the missing attribution this sub-plan set out to fix, and
// it is independent of identity: the event can be recorded now, and Task 4 fills in WHO once these
// routes carry a signed-in admin instead of a shared key.
import { beforeEach, describe, expect, it } from 'vitest';
import { auditRepo } from '../../src/modules/audit/audit.repo';
import { createServer } from '../../src/server';
import { testDb, truncateAll } from '../helpers/test-db';

const ADMIN_KEY = 'test-admin-key-0000000000000000000';
const HEADERS = { 'x-admin-api-key': ADMIN_KEY, 'content-type': 'application/json' };

const applyBody = {
  businessName: 'Ada Salon',
  payoutBankCode: '000014',
  payoutAccountNumber: '0123456789',
};

const app = createServer();

beforeEach(async () => {
  await truncateAll();
  process.env.ADMIN_API_KEY = ADMIN_KEY;
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

  it('leaves the operator unnamed for now, and says so honestly', async () => {
    // These routes still authenticate with the shared `ADMIN_API_KEY`, which is not an identity.
    // Both actor columns are therefore null and `actorKind` is 'ops' — the trail records that an
    // operator did it and cannot say which one. Task 4 swaps the middleware and fills this in.
    //
    // If this test fails because `actorAdminUserId` is now populated, that is Task 4 landing:
    // update it to assert the actor instead of deleting it.
    const id = await applyRetailer();
    await app.request(`/retailers/${id}/approve`, { method: 'POST', headers: HEADERS });

    const rows = await auditRepo.listByAction(testDb, 'retailer.approved');
    expect(rows[0]?.actorUserId).toBeNull();
    expect(rows[0]?.actorAdminUserId).toBeNull();
  });
});
