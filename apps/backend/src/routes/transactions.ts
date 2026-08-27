import { SPEND_CATEGORIES } from '@amana/types';
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

/** Zod needs a non-empty tuple; SPEND_CATEGORIES is the single source of the vocabulary. */
const SPEND_CATEGORY_VALUES = SPEND_CATEGORIES.map((c) => c.value) as [string, ...string[]];

const IntentBodySchema = z.object({
  masterWalletId: z.string().uuid(),
  subWalletId: z.string().uuid().nullable(),
  amountKobo: z.string().regex(/^\d+$/),
  idempotencyKey: z.string().min(1),
  vendorBankCode: z.string().min(1),
  vendorAccountNumber: z.string().min(1),
  /**
   * Capped because this string does not stay inside the transaction.
   *
   * `settlement.service.ts` copies it into `vendor_observations.account_name`, the registry sweep
   * promotes that into `vendors.display_name`, and `routes/vendor-page.ts` renders it under a
   * "Verified on Amana" badge on an unauthenticated page. So a client-controlled field reaches the
   * open internet, and `min(1)` alone let it be arbitrarily long.
   *
   * This is defence in depth, NOT the fix. The fix is provenance: `vendorClaimService.verify`
   * overwrites `display_name` with the name NIBSS returns for the account, so nothing a payer
   * types survives to the public page of a self-service-claimed vendor. The cap bounds the blast
   * radius of everything upstream of that — the observation rows, the logs, and the ops-claimed
   * vendors whose name is still observation-derived.
   *
   * 200 rather than a new number: `routes/retailers.ts`'s `businessName` already sets 200 as this
   * repo's bar for "cannot truncate a real Nigerian business name", and this is the same shape of
   * string. Reusing the existing cap leaves nothing for a later reader to reconcile.
   */
  vendorResolvedName: z.string().min(1).max(200),
  /**
   * A CLOSED vocabulary, and this is a spend control rather than a formatting preference.
   *
   * `evaluators/category.ts` compares this string to a rule's `categories` with `includes()` —
   * exact match, no trim, no case fold. Free text therefore breaks the two rule modes in opposite
   * directions, and only one of them fails safe:
   *
   * - **allowlist** — an out-of-vocabulary value matches nothing and the spend is DENIED. Safe.
   * - **blocklist** — an out-of-vocabulary value matches nothing and the spend is ALLOWED. An
   *   agent holding their own bearer token sends `'Groceries'` or `'groceries '` and a principal's
   *   block simply does not fire, while the principal has every reason to believe it did.
   *
   * That is the product's central promise defeated by a capital letter, by exactly the actor the
   * threat model is built around. `/vendor-claim/verify` and `retailer-portal.ts` already constrain
   * this same vocabulary; the spend route is where it matters most and was the one that did not.
   *
   * Rejecting at the door is deliberate over normalising here: a caller who sends a category we
   * cannot evaluate should be told, not silently reinterpreted.
   */
  category: z.enum(SPEND_CATEGORY_VALUES).nullable().default(null),
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
