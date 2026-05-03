import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../helpers/test-db';
import { createServer } from '../../src/server';

const SECRET = 'whsec_test';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('POST /webhooks/anchor', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('200 + audit-log entry on a correctly-signed event', async () => {
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-1',
      type: 'transfer.completed',
      createdAt: '2026-05-03T00:00:00Z',
      data: { transferId: 't-1', reference: 'k-1', status: 'COMPLETED', nibssSessionId: '12345' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const audit = await testDb.execute<{ subject_id: string; action: string }>(sql`
      SELECT subject_id, action FROM audit_log WHERE subject_kind = 'anchor_webhook'
    `);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('anchor.webhook.transfer.completed');
  });

  it('401 + no audit entry on bad signature', async () => {
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-2', type: 'transfer.completed', createdAt: '2026-05-03T00:00:00Z', data: {},
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': 'wrong' },
      body,
    });
    expect(res.status).toBe(401);
    const audit = await testDb.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM audit_log`);
    expect(audit[0]?.count).toBe('0');
  });

  it('503 when ANCHOR_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.ANCHOR_WEBHOOK_SECRET;
    const app = createServer();
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': 'whatever' },
      body: '{}',
    });
    expect(res.status).toBe(503);
  });

  it('replay of the same event id is a no-op (idempotent on event.id)', async () => {
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-3', type: 'transfer.completed', createdAt: '2026-05-03T00:00:00Z',
      data: { transferId: 't-x', reference: 'k-x', status: 'COMPLETED' },
    });
    const headers = { 'content-type': 'application/json', 'x-anchor-signature': sign(body) };
    await app.request('/webhooks/anchor', { method: 'POST', headers, body });
    await app.request('/webhooks/anchor', { method: 'POST', headers, body });
    const audit = await testDb.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM audit_log WHERE action LIKE 'anchor.webhook.%'
    `);
    expect(audit[0]?.count).toBe('1'); // exactly one entry, not two
  });
});
