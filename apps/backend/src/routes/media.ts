import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { mediaService } from '../modules/media/media.service';
import { transactionsRepo } from '../modules/wallet/transactions.repo';
import { assertWalletAccess } from '../modules/wallet/wallet-access.service';

const UploadUrlSchema = z.object({
  transactionId: z.string().uuid(),
  contentType: z.enum(['image/jpeg', 'image/png']),
});

export const mediaRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/upload-url', async (c) => {
    const body = await parseBody(c, UploadUrlSchema);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;

    const txn = await transactionsRepo.findById(db, body.transactionId);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    await assertWalletAccess(db, a.userId, {
      masterWalletId: txn.masterWalletId,
      subWalletId: txn.subWalletId,
    });

    const result = await mediaService.getUploadUrl(body.transactionId, body.contentType);
    return c.json(result, 200);
  });
