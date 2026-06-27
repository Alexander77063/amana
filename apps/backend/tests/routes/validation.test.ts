import { beforeEach, describe, expect, it, vi } from 'vitest';

// media route calls out to S3 presigning; stub it so validation cases that
// pass validation never touch AWS (the 400 cases short-circuit before this).
vi.mock('../../src/modules/media/media.service', () => ({
  mediaService: {
    getUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: 'https://s3/put', key: 'media/x.jpg' }),
  },
}));

import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function principalHeaders() {
  const u = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  return bearerHeaders(u);
}

async function agentHeaders() {
  const u = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  return bearerHeaders(u);
}

describe('input validation hardening', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('POST /bumps/:id/decision → 400 on a non-uuid id', async () => {
    const app = createServer();
    const res = await app.request('/bumps/not-a-uuid/decision', {
      method: 'POST',
      headers: await principalHeaders(),
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /bumps/:id/decision → 400 on an invalid decision enum', async () => {
    const app = createServer();
    const res = await app.request(`/bumps/${factories.txnId()}/decision`, {
      method: 'POST',
      headers: await principalHeaders(),
      body: JSON.stringify({ decision: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /bumps/:id/decision → 400 (not 500) on a non-JSON body', async () => {
    const app = createServer();
    const res = await app.request(`/bumps/${factories.txnId()}/decision`, {
      method: 'POST',
      headers: await principalHeaders(),
      body: 'definitely-not-json{',
    });
    expect(res.status).toBe(400);
  });

  it('POST /media/upload-url → 400 on an unsupported content type', async () => {
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      headers: await agentHeaders(),
      body: JSON.stringify({ transactionId: factories.txnId(), contentType: 'image/gif' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /media/upload-url → 400 (not 500) on a non-uuid transactionId', async () => {
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      headers: await agentHeaders(),
      body: JSON.stringify({ transactionId: 'abc', contentType: 'image/png' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /vendors/nqr-decode → 400 on missing fields', async () => {
    const app = createServer();
    const res = await app.request('/vendors/nqr-decode', {
      method: 'POST',
      headers: await agentHeaders(),
      body: JSON.stringify({ payload: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /vendors/recents → 400 (not 500) on a non-uuid subWalletId', async () => {
    const app = createServer();
    const res = await app.request('/vendors/recents?subWalletId=not-a-uuid', {
      headers: await agentHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it('POST /me/notifications/:id/read → 400 (not 500) on a non-uuid id', async () => {
    const app = createServer();
    const res = await app.request('/me/notifications/not-a-uuid/read', {
      method: 'POST',
      headers: await principalHeaders(),
    });
    expect(res.status).toBe(400);
  });
});
