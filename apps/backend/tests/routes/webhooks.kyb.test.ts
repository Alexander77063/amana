import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import { createServer } from '../../src/server';
import { testDb, truncateAll } from '../helpers/test-db';

const SECRET = 'whsec_kyb_test';
const app = createServer();

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function postEvent(id: string, type: string, data: unknown) {
  const body = JSON.stringify({ id, type, createdAt: '2026-07-06T10:00:00Z', data });
  return app.request('/webhooks/anchor', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
  });
}

async function seedPendingRetailer(businessCustomerId: string) {
  return retailersRepo.insert(testDb, {
    businessName: 'Ada Salon',
    payoutBankCode: '000014',
    payoutAccountNumber: '0123456789',
    onboardingStatus: 'kyb_pending',
    anchorBusinessCustomerId: businessCustomerId,
  });
}

describe('POST /webhooks/anchor — kyb dispatch', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('kyb.approved moves the retailer to approved', async () => {
    const r = await seedPendingRetailer('biz-wh-1');
    const res = await postEvent('evt-kyb-1', 'kyb.approved', { businessCustomerId: 'biz-wh-1' });
    expect(res.status).toBe(200);
    expect((await retailersRepo.findById(testDb, r.id))?.onboardingStatus).toBe('approved');
  });

  it('kyb.rejected moves the retailer to suspended', async () => {
    const r = await seedPendingRetailer('biz-wh-2');
    const res = await postEvent('evt-kyb-2', 'kyb.rejected', {
      businessCustomerId: 'biz-wh-2',
      reason: 'RC number mismatch',
    });
    expect(res.status).toBe(200);
    expect((await retailersRepo.findById(testDb, r.id))?.onboardingStatus).toBe('suspended');
  });

  it('a re-delivered kyb.approved is a 200 no-op (idempotent)', async () => {
    const r = await seedPendingRetailer('biz-wh-3');
    await postEvent('evt-kyb-3', 'kyb.approved', { businessCustomerId: 'biz-wh-3' });
    const again = await postEvent('evt-kyb-3', 'kyb.approved', { businessCustomerId: 'biz-wh-3' });
    expect(again.status).toBe(200);
    expect((await retailersRepo.findById(testDb, r.id))?.onboardingStatus).toBe('approved');
  });

  it('a late kyb.rejected cannot un-approve a live retailer', async () => {
    const r = await seedPendingRetailer('biz-wh-4');
    await postEvent('evt-kyb-4a', 'kyb.approved', { businessCustomerId: 'biz-wh-4' });
    const res = await postEvent('evt-kyb-4b', 'kyb.rejected', {
      businessCustomerId: 'biz-wh-4',
      reason: 'late',
    });
    expect(res.status).toBe(200);
    expect((await retailersRepo.findById(testDb, r.id))?.onboardingStatus).toBe('approved');
  });

  it('acks 200 when no retailer matches the business customer id', async () => {
    const res = await postEvent('evt-kyb-5', 'kyb.approved', { businessCustomerId: 'biz-nobody' });
    expect(res.status).toBe(200);
  });

  it('401s a kyb event with a bad signature', async () => {
    const body = JSON.stringify({
      id: 'evt-kyb-6',
      type: 'kyb.approved',
      createdAt: '2026-07-06T10:00:00Z',
      data: { businessCustomerId: 'biz-wh-1' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(`${body} `) },
    });
    expect(res.status).toBe(401);
  });
});
