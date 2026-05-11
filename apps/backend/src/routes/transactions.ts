import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { transactions } from '../db/schema';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { kobo } from '../lib/kobo';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { transactionDetailService } from '../modules/transactions/detail.service';
import { lifecycleService } from '../modules/transactions/lifecycle.service';
import { nipOutService } from '../modules/transactions/nip-out.service';
import { txnIntentService } from '../modules/transactions/txn-intent.service';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

export const transactionsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
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
      transactionId: id,
      initiatingUserId: a.userId,
      now: new Date(),
    });
    if (result.kind === 'allow') {
      return c.json({ kind: 'allow', status: result.transaction.status }, 200);
    }
    return c.json(
      {
        kind: 'bump_pending',
        bumpRequestId: result.bumpRequestId,
        status: result.transaction.status,
      },
      202,
    );
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
      transactionId: id,
      householdRef,
      now: new Date(),
    });
    return c.json(result, 202);
  })
  .post('/:id/resume-after-bump', async (c) => {
    const body = await c.req.json<{ token: string }>();
    if (!body.token) return c.json({ error: 'missing_token' }, 400);
    const result = await lifecycleService.resumeAfterBump(db, {
      token: body.token,
      now: new Date(),
    });
    return c.json({ status: result.transaction.status }, 200);
  })
  .get('/:id', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');

    if (a.role === 'principal') {
      const detail = await transactionDetailService.getByIdForPrincipal(db, id, a.userId);
      if (!detail) return c.json({ error: 'not_found' }, 404);
      return c.json({ transaction: detail }, 200);
    }

    if (a.role === 'agent') {
      const detail = await transactionDetailService.getByIdForAgent(db, id, a.userId);
      if (!detail) return c.json({ error: 'not_found' }, 404);
      return c.json({ transaction: detail }, 200);
    }

    return c.json({ error: 'forbidden' }, 403);
  })
  .patch('/:id/media', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    const body = await c.req.json<{ mediaKey?: string }>();
    if (!body.mediaKey) return c.json({ error: 'missing_media_key' }, 400);

    const [txn] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'settled') return c.json({ error: 'not_settled' }, 409);

    await db
      .update(transactions)
      .set({ attachedMedia: { key: body.mediaKey, uploadedAt: new Date().toISOString() } })
      .where(eq(transactions.id, id));

    return c.json({ ok: true }, 200);
  })
  .delete('/:id/bump', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');

    const [txn] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'bump_pending') return c.json({ error: 'not_bump_pending' }, 409);

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE bump_requests SET status = 'cancelled' WHERE transaction_id = ${id}`,
      );
      await tx
        .update(transactions)
        .set({ status: 'failed', errorMessage: 'CANCELLED_BY_AGENT' })
        .where(eq(transactions.id, id));
    });

    return c.json({ ok: true }, 200);
  });
