import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { NotFoundError } from '../lib/errors';
import { parseBody, parseQuery } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { browseService } from '../modules/marketplace/browse.service';
import { merchantApprovalService } from '../modules/marketplace/merchant-approval.service';
import { purchaseService } from '../modules/marketplace/purchase.service';
import { type RedemptionRow, redemptionsRepo } from '../modules/marketplace/redemptions.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';
import { assertSubWalletAccess } from '../modules/wallet/wallet-access.service';

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

const BrowseQuerySchema = z.object({
  /**
   * Whose rules to filter by. An agent's app passes its own sub-wallet; a principal may pass one
   * to preview what their agent sees, or omit it for the full marketplace.
   */
  subWalletId: z.string().uuid().optional(),
  section: z.string().min(1).max(60).optional(),
});

const ApproveBodySchema = z.object({
  subWalletId: z.string().uuid(),
  retailerId: z.string().uuid(),
});

/**
 * Resolve whose rules apply, and refuse to browse as someone else.
 *
 * An agent may only ever browse through their OWN sub-wallet: letting one pass another's id would
 * turn the catalogue into a way to read what a different household has approved. A principal may
 * pass any sub-wallet they own, which `assertSubWalletAccess` enforces at purchase time and which
 * is checked here too so browsing cannot leak what buying would refuse.
 */
async function resolveBrowseScope(
  actor: Actor,
  requested: string | undefined,
): Promise<string | null> {
  if (actor.role === 'agent') {
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM sub_wallets WHERE agent_user_id = ${actor.userId} LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }
  if (!requested) return null;
  const sw = await subWalletsRepo.findById(db, requested);
  if (!sw) throw new NotFoundError(`sub-wallet ${requested} not found`);
  await assertSubWalletAccess(db, actor.userId, requested, { principalOnly: true });
  return requested;
}

export const marketplaceRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/sections', async (c) => {
    const q = parseQuery(c, BrowseQuerySchema);
    if (q instanceof Response) return q;
    const scope = await resolveBrowseScope(c.get('actor') as Actor, q.subWalletId);
    return c.json({ sections: await browseService.sections(db, scope) }, 200);
  })
  .get('/items', async (c) => {
    const q = parseQuery(c, BrowseQuerySchema);
    if (q instanceof Response) return q;
    const scope = await resolveBrowseScope(c.get('actor') as Actor, q.subWalletId);
    const items = await browseService.items(db, {
      subWalletId: scope,
      section: q.section ?? null,
    });
    return c.json({ items }, 200);
  })
  .get('/merchants', async (c) => {
    const q = parseQuery(c, BrowseQuerySchema);
    if (q instanceof Response) return q;
    const scope = await resolveBrowseScope(c.get('actor') as Actor, q.subWalletId);
    if (!scope) return c.json({ approvedRetailerIds: null }, 200);
    return c.json(
      { approvedRetailerIds: await merchantApprovalService.approvedRetailerIds(db, scope) },
      200,
    );
  })
  // The control fusion, from the principal's side: approving a merchant edits the sub-wallet's
  // rule set. Principal-only, by ownership, enforced in the service.
  .post('/merchants/approve', async (c) => {
    const body = await parseBody(c, ApproveBodySchema);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const r = await merchantApprovalService.approve(db, {
      actorUserId: a.userId,
      subWalletId: body.subWalletId,
      retailerId: body.retailerId,
    });
    return c.json(r, 200);
  })
  .post('/merchants/revoke', async (c) => {
    const body = await parseBody(c, ApproveBodySchema);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const r = await merchantApprovalService.revoke(db, {
      actorUserId: a.userId,
      subWalletId: body.subWalletId,
      retailerId: body.retailerId,
    });
    return c.json(r, 200);
  })
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
