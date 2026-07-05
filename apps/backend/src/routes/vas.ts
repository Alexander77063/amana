import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { NotFoundError } from '../lib/errors';
import { parseBody, parseParams, parseQuery } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { beneficiariesService } from '../modules/vas/beneficiaries.service';
import { vasCatalogService } from '../modules/vas/catalog.service';
import { vasPurchaseService } from '../modules/vas/purchase.service';
import { vasPurchasesRepo } from '../modules/vas/vas-purchases.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

const CATEGORY = z.enum(['airtime', 'data', 'electricity', 'cabletv']);

// Amount is sent as a kobo string (mirrors `routes/transactions.ts` — no floats, no JSON-number
// precision loss); `BigInt()` at the call site, then the service brands it via `kobo()`.
const PurchaseBody = z.object({
  subWalletId: z.string().uuid().nullable().optional(),
  category: CATEGORY,
  provider: z.string().min(1),
  productSlug: z.string().min(1).nullable().optional(),
  recipient: z.string().min(3),
  amountKobo: z.string().regex(/^\d+$/),
  idempotencyKey: z.string().min(1),
});

const BeneficiaryBody = z.object({
  subWalletId: z.string().uuid(),
  kind: z.enum(['phone', 'meter', 'smartcard']),
  value: z.string().min(3),
  label: z.string().min(1),
});

/**
 * Resolve the master wallet the purchase draws from: the sub-wallet's master for an agent buy, or
 * the actor's own household master for a principal-direct buy. Ownership is authorized in the
 * service (`assertWalletAccess`) by identity vs. ownership — never the JWT role.
 */
async function resolveMaster(actorUserId: string, subWalletId: string | null): Promise<string> {
  if (subWalletId) {
    const sw = await subWalletsRepo.findById(db, subWalletId);
    if (!sw) throw new NotFoundError(`sub-wallet ${subWalletId} not found`);
    return sw.masterWalletId;
  }
  const hh = await householdsRepo.findByPrincipal(db, actorUserId);
  if (!hh) throw new NotFoundError('no household for actor');
  const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
  if (!mw) throw new NotFoundError('no master wallet for household');
  return mw.id;
}

/** Buyer-facing purchase view: bigint kobo stringified so `c.json` doesn't 500 on BigInt. */
type VasPurchaseRow = NonNullable<Awaited<ReturnType<typeof vasPurchasesRepo.findById>>>;
function serializeVas(v: VasPurchaseRow) {
  return {
    id: v.id,
    category: v.category,
    provider: v.provider,
    productSlug: v.productSlug,
    recipientKind: v.recipientKind,
    recipient: v.recipient,
    customerName: v.customerName,
    amountKobo: (v.amountKobo as bigint).toString(),
    commissionKobo: (v.commissionKobo as bigint).toString(),
    status: v.status,
    token: v.token,
    anchorBillId: v.anchorBillId,
    createdAt: v.createdAt,
    completedAt: v.completedAt,
  };
}

export const vasRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/billers', async (c) => {
    const q = parseQuery(c, z.object({ category: CATEGORY }));
    if (q instanceof Response) return q;
    const billers = await vasCatalogService.listBillers(anchorAdapterSingleton, q.category);
    return c.json({ billers }, 200);
  })
  .get('/billers/:billerId/products', async (c) => {
    const products = await vasCatalogService.listProducts(
      anchorAdapterSingleton,
      c.req.param('billerId'),
    );
    return c.json({ products }, 200);
  })
  .get('/validate', async (c) => {
    const q = parseQuery(c, z.object({ provider: z.string().min(1), account: z.string().min(3) }));
    if (q instanceof Response) return q;
    const customer = await vasCatalogService.validateCustomer(
      anchorAdapterSingleton,
      q.provider,
      q.account,
    );
    return c.json({ customer }, 200);
  })
  .post('/purchase', async (c) => {
    const body = await parseBody(c, PurchaseBody);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const subWalletId = body.subWalletId ?? null;
    const masterWalletId = await resolveMaster(a.userId, subWalletId);

    const out = await vasPurchaseService.create(db, anchorAdapterSingleton, {
      actorUserId: a.userId,
      masterWalletId,
      subWalletId,
      category: body.category,
      provider: body.provider,
      productSlug: body.productSlug ?? null,
      recipient: body.recipient,
      amountKobo: BigInt(body.amountKobo),
      idempotencyKey: body.idempotencyKey,
    });
    const vas = await vasPurchasesRepo.findById(db, out.vasPurchaseId);
    if (!vas) throw new NotFoundError('vas purchase not found after create');
    return c.json({ purchase: serializeVas(vas) }, 201);
  })
  .get('/purchases', async (c) => {
    const a = c.get('actor') as Actor;
    const rows = await vasPurchasesRepo.listByBuyer(db, a.userId);
    return c.json({ purchases: rows.map(serializeVas) }, 200);
  })
  .post('/beneficiaries', async (c) => {
    const body = await parseBody(c, BeneficiaryBody);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const beneficiary = await beneficiariesService.add(db, {
      actorUserId: a.userId,
      subWalletId: body.subWalletId,
      kind: body.kind,
      value: body.value,
      label: body.label,
    });
    return c.json({ beneficiary }, 201);
  })
  .get('/beneficiaries', async (c) => {
    const q = parseQuery(c, z.object({ subWalletId: z.string().uuid() }));
    if (q instanceof Response) return q;
    const a = c.get('actor') as Actor;
    const beneficiaries = await beneficiariesService.list(db, a.userId, q.subWalletId);
    return c.json({ beneficiaries }, 200);
  })
  .delete('/beneficiaries/:id', async (c) => {
    // Validate the path UUID so a malformed id returns 400, not a Postgres 22P02 → 500.
    const p = parseParams(c, z.object({ id: z.string().uuid() }));
    if (p instanceof Response) return p;
    const a = c.get('actor') as Actor;
    await beneficiariesService.remove(db, a.userId, p.id);
    return c.json({ ok: true }, 200);
  });
