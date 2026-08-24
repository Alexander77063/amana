import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { kobo } from '../lib/kobo';
import { parseBody } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { bumpWorkflowService } from '../modules/bumps/bump-workflow.service';
import { householdsRepo } from '../modules/identity/households.repo';
import { transactionDetailService } from '../modules/transactions/detail.service';
import { lifecycleService } from '../modules/transactions/lifecycle.service';
import { nipOutService } from '../modules/transactions/nip-out.service';
import { txnIntentService } from '../modules/transactions/txn-intent.service';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../modules/wallet/transactions.repo';

const IntentBodySchema = z.object({
  masterWalletId: z.string().uuid(),
  subWalletId: z.string().uuid().nullable(),
  amountKobo: z.string().regex(/^\d+$/),
  idempotencyKey: z.string().min(1),
  vendorBankCode: z.string().min(1),
  vendorAccountNumber: z.string().min(1),
  vendorResolvedName: z.string().min(1),
  category: z.string().nullable().default(null),
  agentNote: z.string().nullable().default(null),
});

/**
 * A malformed id must never reach Postgres — an invalid uuid literal raises a driver error
 * that surfaces as a 500 (and as Sentry noise) instead of the 400 the caller deserves.
 */
const UuidSchema = z.string().uuid();
const isUuid = (v: string): boolean => UuidSchema.safeParse(v).success;

const ResumeBodySchema = z.object({ token: z.string().min(1) });

const AttachMediaBodySchema = z.object({ mediaKey: z.string().min(1) });

export const transactionsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/intent', async (c) => {
    const body = await parseBody(c, IntentBodySchema);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const txn = await txnIntentService.create(db, {
      actorUserId: a.userId,
      masterWalletId: body.masterWalletId,
      subWalletId: body.subWalletId,
      amountKobo: kobo(BigInt(body.amountKobo)),
      idempotencyKey: body.idempotencyKey,
      vendorBankCode: body.vendorBankCode,
      vendorAccountNumber: body.vendorAccountNumber,
      vendorResolvedName: body.vendorResolvedName,
      category: body.category ?? null,
      agentNote: body.agentNote ?? null,
    });
    return c.json({ transactionId: txn.id, status: txn.status }, 201);
  })
  .post('/:id/evaluate', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'invalid_transaction_id' }, 400);
    const a = c.get('actor') as Actor;
    const result = await lifecycleService.evaluate(db, {
      transactionId: id,
      initiatingUserId: a.userId,
      now: new Date(),
    });
    if (result.kind === 'allow') {
      return c.json({ kind: 'allow', status: result.transaction.status }, 200);
    }
    // `expiresAt` is what the agent's wait screen counts down to. It was missing here while
    // the api-client type declared it, so the countdown rendered "NaN:NaN" on a live screen.
    return c.json(
      {
        kind: 'bump_pending',
        bumpRequestId: result.bumpRequestId,
        status: result.transaction.status,
        expiresAt: result.bumpExpiresAt.toISOString(),
      },
      202,
    );
  })
  .post('/:id/send', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'invalid_transaction_id' }, 400);
    const a = c.get('actor') as Actor;
    const txn = await transactionsRepo.findById(db, id);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    const mw = await masterWalletsRepo.findById(db, txn.masterWalletId);
    if (!mw) return c.json({ error: 'master_wallet_not_found' }, 404);
    const hh = await householdsRepo.findById(db, mw.householdId);
    const householdRef = hh ? hh.id : txn.masterWalletId;
    const result = await nipOutService.send(db, anchorAdapterSingleton, {
      transactionId: id,
      actorUserId: a.userId,
      householdRef,
      now: new Date(),
    });
    return c.json(result, 202);
  })
  .post('/:id/resume-after-bump', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'invalid_transaction_id' }, 400);
    const body = await parseBody(c, ResumeBodySchema);
    if (body instanceof Response) return body;
    const result = await lifecycleService.resumeAfterBump(db, {
      token: body.token,
      now: new Date(),
      expectedTransactionId: id,
    });
    return c.json({ status: result.transaction.status }, 200);
  })
  .get('/:id', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'invalid_transaction_id' }, 400);
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
    if (!isUuid(id)) return c.json({ error: 'invalid_transaction_id' }, 400);
    const body = await parseBody(c, AttachMediaBodySchema);
    if (body instanceof Response) return body;
    const txn = await transactionsRepo.findById(db, id);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'settled') return c.json({ error: 'not_settled' }, 409);
    await transactionsRepo.attachMedia(db, id, body.mediaKey, new Date());
    return c.json({ ok: true }, 200);
  })
  /**
   * The agent's view of the bump on their own transaction, and — once the principal has
   * approved — the one-shot token that lets them continue.
   *
   * Without this the token had no way to reach the device that needs it: it is minted for the
   * principal's response, and the push to the agent omits it on purpose (a capability does not
   * belong in a push payload). The agent's wait screen polls this, which also means a dropped
   * push no longer strands the payment until the bump expires.
   */
  .get('/:id/bump', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'invalid_transaction_id' }, 400);
    if (a.role !== 'agent') return c.json({ error: 'agent_only' }, 403);
    const result = await bumpWorkflowService.statusForAgent(db, {
      transactionId: id,
      agentUserId: a.userId,
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json(result, 200);
  })
  .delete('/:id/bump', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'invalid_transaction_id' }, 400);
    const txn = await transactionsRepo.findById(db, id);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'bump_pending') return c.json({ error: 'not_bump_pending' }, 409);
    await bumpWorkflowService.cancelByAgent(db, id);
    return c.json({ ok: true }, 200);
  });
