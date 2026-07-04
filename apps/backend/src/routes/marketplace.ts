import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { NotFoundError } from '../lib/errors';
import { parseBody } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { purchaseService } from '../modules/marketplace/purchase.service';
import { type RedemptionRow, redemptionsRepo } from '../modules/marketplace/redemptions.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

// No price fields — the server prices from the catalog (`effectivePriceKobo`); a client-supplied
// price would be a discount-spoof vector. UUIDs validated so malformed ids 400 (never a PG 500).
const PurchaseBodySchema = z.object({
  subWalletId: z.string().uuid().nullable().optional(),
  catalogItemId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
});

/** Buyer-facing voucher view: bigint kobo columns stringified so `c.json` doesn't 500 on BigInt. */
function serializeVoucher(r: RedemptionRow) {
  return {
    id: r.id,
    code: r.code,
    qrToken: r.qrToken,
    grossKobo: (r.grossKobo as bigint).toString(),
    discountedKobo: (r.discountedKobo as bigint).toString(),
    status: r.status,
    expiresAt: r.expiresAt.toISOString(),
  };
}

export const marketplaceRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/purchase', async (c) => {
    const body = await parseBody(c, PurchaseBodySchema);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const subWalletId = body.subWalletId ?? null;

    // Resolve the master wallet the buy draws from: the sub-wallet's master for an agent buy, or
    // the actor's own household master for a principal-direct buy. Ownership is authorized in the
    // service (`assertWalletAccess`) by identity vs. ownership — never the JWT role.
    let masterWalletId: string;
    if (subWalletId) {
      const sw = await subWalletsRepo.findById(db, subWalletId);
      if (!sw) throw new NotFoundError(`sub-wallet ${subWalletId} not found`);
      masterWalletId = sw.masterWalletId;
    } else {
      const hh = await householdsRepo.findByPrincipal(db, a.userId);
      if (!hh) throw new NotFoundError('no household for actor');
      const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
      if (!mw) throw new NotFoundError('no master wallet for household');
      masterWalletId = mw.id;
    }

    const { redemption } = await purchaseService.createFromCatalog(db, {
      actorUserId: a.userId,
      masterWalletId,
      subWalletId,
      catalogItemId: body.catalogItemId,
      idempotencyKey: body.idempotencyKey,
    });
    return c.json({ voucher: serializeVoucher(redemption) }, 201);
  })
  .get('/vouchers', async (c) => {
    const a = c.get('actor') as Actor;
    const rows = await redemptionsRepo.findByBuyer(db, a.userId);
    return c.json({ vouchers: rows.map(serializeVoucher) }, 200);
  });
