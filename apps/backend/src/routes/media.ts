import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { transactions } from '../db/schema';
import { parseBody } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { mediaService } from '../modules/media/media.service';

const UploadUrlSchema = z.object({
  transactionId: z.string().uuid(),
  contentType: z.enum(['image/jpeg', 'image/png']),
});

export const mediaRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/upload-url', async (c) => {
    const body = await parseBody(c, UploadUrlSchema);
    if (body instanceof Response) return body;

    const [txn] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, body.transactionId))
      .limit(1);
    if (!txn) return c.json({ error: 'not_found' }, 404);

    const result = await mediaService.getUploadUrl(body.transactionId, body.contentType);
    return c.json(result, 200);
  });
