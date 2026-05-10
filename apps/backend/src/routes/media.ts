import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { transactions } from '../db/schema';
import { mediaService } from '../modules/media/media.service';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';

export const mediaRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/upload-url', async (c) => {
    const body = await c.req.json<{ transactionId?: string; contentType?: string }>();
    if (!body.transactionId || !body.contentType) {
      return c.json({ error: 'missing_params' }, 400);
    }
    if (body.contentType !== 'image/jpeg' && body.contentType !== 'image/png') {
      return c.json({ error: 'invalid_content_type' }, 400);
    }

    const [txn] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, body.transactionId))
      .limit(1);
    if (!txn) return c.json({ error: 'not_found' }, 404);

    const result = await mediaService.getUploadUrl(
      body.transactionId,
      body.contentType as 'image/jpeg' | 'image/png',
    );
    return c.json(result, 200);
  });
