import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { pairingService } from '../modules/auth/pairing.service';
import { householdsRepo } from '../modules/identity/households.repo';

export const pairingRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const IssueSchema = z.object({ householdId: z.string().uuid() });
    const body = await parseBody(c, IssueSchema);
    if (body instanceof Response) return body;
    const hh = await householdsRepo.findById(db, body.householdId);
    if (!hh) return c.json({ error: 'household_not_found' }, 404);
    if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
    const t = await pairingService.issue(db, {
      principalUserId: a.userId,
      householdId: body.householdId,
    });
    return c.json(
      {
        pairingTokenId: t.id,
        code: t.code,
        expiresAt: t.expiresAt.toISOString(),
      },
      201,
    );
  })
  .post('/complete', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'agent') return c.json({ error: 'agent_only' }, 403);

    const CompleteSchema = z.object({ token: z.string().min(1) });
    const body = await parseBody(c, CompleteSchema);
    if (body instanceof Response) return body;

    const result = await pairingService.consume(db, { code: body.token, agentUserId: a.userId });
    if (result.kind === 'not_found') return c.json({ error: 'invalid_or_expired_token' }, 404);

    type SwRow = { id: string };
    const rows = await db.execute<SwRow>(sql`
      SELECT sw.id
      FROM sub_wallets sw
      JOIN master_wallets mw ON mw.id = sw.master_wallet_id
      WHERE mw.household_id = ${result.householdId}
        AND sw.agent_user_id = ${a.userId}
      LIMIT 1
    `);

    return c.json({ subWalletId: rows[0]?.id ?? null }, 200);
  });
