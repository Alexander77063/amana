import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';

type SubWalletRow = {
  sw_id: string;
  sw_name: string;
  master_wallet_id: string;
  principal_user_id: string;
  principal_phone: string;
};

export const meSubWalletRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/sub-wallet', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'agent') return c.json({ error: 'agent_only' }, 403);

    const rows = await db.execute<SubWalletRow>(sql`
      SELECT
        sw.id             AS sw_id,
        sw.name           AS sw_name,
        sw.master_wallet_id,
        h.principal_user_id,
        pu.phone          AS principal_phone
      FROM sub_wallets sw
      JOIN master_wallets mw ON mw.id = sw.master_wallet_id
      JOIN households     h  ON h.id  = mw.household_id
      JOIN users          pu ON pu.id = h.principal_user_id
      WHERE sw.agent_user_id = ${a.userId}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) return c.json({ error: 'not_paired' }, 404);

    return c.json(
      {
        subWallet: { id: row.sw_id, name: row.sw_name, masterWalletId: row.master_wallet_id },
        principal: { userId: row.principal_user_id, phone: row.principal_phone },
      },
      200,
    );
  });
