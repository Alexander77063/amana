import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { transactions } from '../db/schema';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { actor, type Actor, type ActorVariables } from '../middleware/actor';
import { kobo } from '../lib/kobo';
import { txnIntentService } from '../modules/transactions/txn-intent.service';
import { lifecycleService } from '../modules/transactions/lifecycle.service';
import { nipOutService } from '../modules/transactions/nip-out.service';
import { householdsRepo } from '../modules/identity/households.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';

export const transactionsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(actor())
  .post('/intent', async (c) => {
    type Body = {
      masterWalletId: string;
      subWalletId: string | null;
      amountKobo: string;
      idempotencyKey: string;
      vendorBankCode: string;
      vendorAccountNumber: string;
      vendorResolvedName: string;
      category: string | null;
      agentNote: string | null;
    };
    const body = await c.req.json<Body>();
    const txn = await txnIntentService.create(db, {
      masterWalletId: body.masterWalletId,
      subWalletId: body.subWalletId,
      amountKobo: kobo(BigInt(body.amountKobo)),
      idempotencyKey: body.idempotencyKey,
      vendorBankCode: body.vendorBankCode,
      vendorAccountNumber: body.vendorAccountNumber,
      vendorResolvedName: body.vendorResolvedName,
      category: body.category,
      agentNote: body.agentNote,
    });
    return c.json({ transactionId: txn.id, status: txn.status }, 201);
  })
  .post('/:id/evaluate', async (c) => {
    const id = c.req.param('id');
    const a = c.get('actor') as Actor;
    const result = await lifecycleService.evaluate(db, {
      transactionId: id, initiatingUserId: a.userId, now: new Date(),
    });
    if (result.kind === 'allow') {
      return c.json({ kind: 'allow', status: result.transaction.status }, 200);
    }
    return c.json({
      kind: 'bump_pending', bumpRequestId: result.bumpRequestId,
      status: result.transaction.status,
    }, 202);
  })
  .post('/:id/send', async (c) => {
    const id = c.req.param('id');
    // Look up the txn + household for narration.
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const mw = await masterWalletsRepo.findById(db, row.masterWalletId);
    if (!mw) return c.json({ error: 'master_wallet_not_found' }, 404);
    const hh = await householdsRepo.findById(db, mw.householdId);
    const householdRef = hh ? hh.id : row.masterWalletId;

    const result = await nipOutService.send(db, anchorAdapterSingleton, {
      transactionId: id, householdRef, now: new Date(),
    });
    return c.json(result, 202);
  })
  .post('/:id/resume-after-bump', async (c) => {
    const body = await c.req.json<{ token: string }>();
    if (!body.token) return c.json({ error: 'missing_token' }, 400);
    const result = await lifecycleService.resumeAfterBump(db, {
      token: body.token, now: new Date(),
    });
    return c.json({ status: result.transaction.status }, 200);
  });
