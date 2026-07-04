import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { kobo } from '../lib/kobo';
import { parseBody } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { purchaseService } from '../modules/marketplace/purchase.service';
import { type RedemptionRow, redemptionsRepo } from '../modules/marketplace/redemptions.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

const PurchaseBodySchema = z.object({
  // null / omitted → principal-direct purchase off the household master LA (decision #17).
  subWalletId: z.string().uuid().nullable().optional(),
  retailerId: z.string().min(1),
  catalogItemId: z.string().min(1),
  retailerBankCode: z.string().min(1),
  retailerAccount: z.string().min(1),
  // Money on the wire is a kobo integer string (mirrors POST /transactions/intent's amountKobo).
  grossKobo: z.string().regex(/^\d+$/),
  discountedKobo: z.string().regex(/^\d+$/),
  idempotencyKey: z.string().min(1),
});

/**
 * Serialize a redemption (voucher) row for the wire: the `*Kobo` columns are `bigint` (mode: bigint)
 * which `c.json` would 500 on, so stringify them; timestamps serialize to ISO via their `toJSON`.
 */
function serializeVoucher(r: RedemptionRow) {
  return {
    id: r.id,
    transactionId: r.transactionId,
    buyerUserId: r.buyerUserId,
    masterWalletId: r.masterWalletId,
    subWalletId: r.subWalletId,
    retailerId: r.retailerId,
    catalogItemId: r.catalogItemId,
    dealId: r.dealId,
    grossKobo: r.grossKobo.toString(),
    discountedKobo: r.discountedKobo.toString(),
    commissionKobo: r.commissionKobo.toString(),
    code: r.code,
    qrToken: r.qrToken,
    status: r.status,
    payoutStatus: r.payoutStatus,
    payoutAttempts: r.payoutAttempts,
    expiresAt: r.expiresAt,
    redeemedAt: r.redeemedAt,
    createdAt: r.createdAt,
  };
}

export const marketplaceRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/purchase', async (c) => {
    const body = await parseBody(c, PurchaseBodySchema);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const subWalletId = body.subWalletId ?? null;

    // Resolve the master wallet for the hold. For a sub-wallet purchase it comes from the
    // sub-wallet's master; ownership is enforced by the service's assertWalletAccess (→ 403). For a
    // direct purchase it comes from the actor's own household master (principal-only, per decision #17).
    let masterWalletId: string;
    if (subWalletId) {
      const sub = await subWalletsRepo.findById(db, subWalletId);
      if (!sub) return c.json({ error: 'sub_wallet_not_found' }, 404);
      masterWalletId = sub.masterWalletId;
    } else {
      const hh = await householdsRepo.findByPrincipal(db, a.userId);
      if (!hh) return c.json({ error: 'no_household' }, 404);
      const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
      if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
      masterWalletId = mw.id;
    }

    // Authorization (sub-wallet ownership / principal-direct) lives in the service; a ForbiddenError
    // maps to 403 and a ConflictError to 409 via the error-handler middleware.
    const { redemption } = await purchaseService.create(db, {
      actorUserId: a.userId,
      masterWalletId,
      subWalletId,
      retailerId: body.retailerId,
      catalogItemId: body.catalogItemId,
      retailerBankCode: body.retailerBankCode,
      retailerAccount: body.retailerAccount,
      grossKobo: kobo(BigInt(body.grossKobo)),
      discountedKobo: kobo(BigInt(body.discountedKobo)),
      idempotencyKey: body.idempotencyKey,
      now: new Date(),
    });

    return c.json({ voucher: serializeVoucher(redemption) }, 201);
  })
  .get('/vouchers', async (c) => {
    const a = c.get('actor') as Actor;
    const rows = await redemptionsRepo.findByBuyer(db, a.userId);
    return c.json({ vouchers: rows.map(serializeVoucher) }, 200);
  });
