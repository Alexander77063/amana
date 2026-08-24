import { SPEND_CATEGORIES } from '@amana/types';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { ForbiddenError } from '../lib/errors';
import { kobo } from '../lib/kobo';
import { parseBody, parseParams, parseQuery } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { catalogItemsRepo } from '../modules/marketplace/catalog-items.repo';
import { catalogService } from '../modules/marketplace/catalog.service';
import { dealsRepo } from '../modules/marketplace/deals.repo';
import { dealsService } from '../modules/marketplace/deals.service';
import { earningsService } from '../modules/marketplace/earnings.service';
import { redeemService } from '../modules/marketplace/redeem.service';
import { redemptionsRepo } from '../modules/marketplace/redemptions.repo';
import { retailerAccessService } from '../modules/marketplace/retailer-access.service';
import { retailerOnboardingService } from '../modules/marketplace/retailer-onboarding.service';
import { retailersRepo } from '../modules/marketplace/retailers.repo';

/**
 * Everything the retailer portal talks to. Mounted at `/retailer`.
 *
 * Two rules hold across every handler here:
 *
 * 1. **The retailer is never taken from the request.** It is resolved from the session's user via
 *    `assertRetailerAccess`, so there is no id a caller could substitute to read or write another
 *    business's data. Routes that do name an id in the path check ownership before using it.
 * 2. **The `actor` claim authorises nothing.** `jwtAuth` establishes who the caller is; a forged
 *    `actor: 'retailer'` still resolves to no owned retailer and is refused.
 */
/** Zod needs a non-empty tuple; SPEND_CATEGORIES is the single source of the vocabulary. */
const SPEND_CATEGORY_VALUES = SPEND_CATEGORIES.map((c) => c.value) as [string, ...string[]];

const UUID = z.object({ id: z.string().uuid() });

const PageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Money arrives as a decimal naira string and is converted once, at the edge, to bigint kobo. */
const NairaSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'invalid_amount')
  .transform((v) => {
    const [whole = '0', frac = ''] = v.split('.');
    return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  });

const ProfileSchema = z.object({
  businessName: z.string().min(1).max(120).optional(),
  contactPhone: z
    .string()
    .regex(/^\+\d{8,15}$/, 'invalid_phone')
    .optional(),
});

const PayoutSchema = z.object({
  payoutBankCode: z.string().min(3).max(10),
  payoutAccountNumber: z.string().regex(/^\d{10}$/, 'invalid_account_number'),
});

const ItemSchema = z.object({
  name: z.string().min(1).max(120),
  priceNaira: NairaSchema,
  /** The retailer's own merchandising label — their words, free text. */
  section: z.string().min(1).max(60),
  /**
   * The spend category a parent's lock is matched against. Constrained to the closed shared
   * vocabulary on purpose: if a retailer could type anything here, they would be deciding whether
   * someone else's spending lock applies to their item.
   */
  category: z.enum(SPEND_CATEGORY_VALUES),
  description: z.string().max(2000).nullish(),
  photoUrl: z.string().url().nullish(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .nullish(),
});

const ItemPatchSchema = ItemSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

const DealSchema = z
  .object({
    catalogItemId: z.string().uuid().nullish(),
    discountBps: z.number().int().positive().max(10_000).nullish(),
    discountNaira: NairaSchema.nullish(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  // Mirrors the service's own invariant (SP2): a deal is either a percentage or a fixed amount
  // off, never both and never neither. Rejecting here turns a 500 into a 400.
  .refine(
    (d) => (d.discountBps == null) !== (d.discountNaira == null),
    'exactly_one_of_discountBps_or_discountNaira',
  );

const DealStatusSchema = z.object({ status: z.enum(['active', 'paused', 'ended']) });

const KybSchema = z.object({
  /** The owner's BVN — Anchor verifies the business against the person behind it. */
  bvn: z.string().regex(/^\d{11}$/, 'invalid_bvn'),
  /** CAC registration number, for a registered company. Absent for a sole trader. */
  rcNumber: z.string().min(1).max(32).optional(),
  email: z.string().email().optional(),
});

const RedeemSchema = z.object({
  /** The short code the buyer reads out, or the token embedded in their QR. */
  code: z.string().min(1).max(64),
});

const itemView = (i: Awaited<ReturnType<typeof catalogItemsRepo.findById>> & object) => ({
  id: i.id,
  name: i.name,
  priceKobo: (i.priceKobo as bigint).toString(),
  section: i.section,
  category: i.category,
  description: i.description,
  photoUrl: i.photoUrl,
  durationMinutes: i.durationMinutes,
  status: i.status,
  createdAt: i.createdAt.toISOString(),
});

export const retailerPortalRoute = new Hono<{ Variables: ActorVariables }>()
  .use('*', jwtAuth())

  // ── Profile, KYB, payout ────────────────────────────────────────────────────────────────────
  .get('/me', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    return c.json(
      {
        retailer: {
          id: r.id,
          businessName: r.businessName,
          contactPhone: r.contactPhone,
          onboardingStatus: r.onboardingStatus,
          payoutBankCode: r.payoutBankCode,
          payoutAccountNumber: r.payoutAccountNumber,
          kybSubmitted: r.anchorBusinessCustomerId !== null,
          approvedAt: r.approvedAt?.toISOString() ?? null,
        },
      },
      200,
    );
  })
  .patch('/me', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const body = await parseBody(c, ProfileSchema);
    if (body instanceof Response) return body;
    const updated = await retailersRepo.updateProfile(db, r.id, body);
    return c.json({ retailer: { id: r.id, businessName: updated?.businessName } }, 200);
  })
  .put('/me/payout', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const body = await parseBody(c, PayoutSchema);
    if (body instanceof Response) return body;
    // Deliberately allowed after approval: a business changing bank is ordinary, and the account
    // is verified by Anchor at payout time, not here.
    await retailersRepo.setPayoutAccount(db, r.id, body);
    return c.json({ ok: true }, 200);
  })
  .post('/me/kyb', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const body = await parseBody(c, KybSchema);
    if (body instanceof Response) return body;
    // Submitting is self-service; APPROVING is not, and stays behind the ops admin key. A
    // retailer that could approve itself would make the whole curated pipeline decorative.
    const updated = await retailerOnboardingService.submitKyb(
      db,
      r.id,
      body,
      anchorAdapterSingleton,
    );
    return c.json({ onboardingStatus: updated.onboardingStatus }, 200);
  })

  // ── Storefront ──────────────────────────────────────────────────────────────────────────────
  .get('/items', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const items = await catalogItemsRepo.listByRetailer(db, r.id);
    return c.json({ items: items.map(itemView) }, 200);
  })
  .post('/items', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    retailerAccessService.assertCanPublish(r);
    const body = await parseBody(c, ItemSchema);
    if (body instanceof Response) return body;
    const item = await catalogService.createItem(db, {
      retailerId: r.id,
      name: body.name,
      priceKobo: kobo(body.priceNaira),
      section: body.section,
      category: body.category,
      description: body.description ?? null,
      photoUrl: body.photoUrl ?? null,
      durationMinutes: body.durationMinutes ?? null,
    });
    return c.json({ item: itemView(item) }, 201);
  })
  .patch('/items/:id', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const params = parseParams(c, UUID);
    if (params instanceof Response) return params;
    const body = await parseBody(c, ItemPatchSchema);
    if (body instanceof Response) return body;

    const existing = await catalogItemsRepo.findById(db, params.id);
    // Ownership before mutation, and a not-found is reported the same way as someone else's item:
    // probing ids must not distinguish "does not exist" from "is not yours".
    if (!existing || existing.retailerId !== r.id) throw new ForbiddenError('not_your_item');

    const { status, priceNaira, ...rest } = body;
    if (priceNaira !== undefined || Object.keys(rest).length > 0) {
      retailerAccessService.assertCanPublish(r);
      await catalogItemsRepo.update(db, params.id, {
        ...rest,
        ...(priceNaira !== undefined ? { priceKobo: kobo(priceNaira) } : {}),
      });
    }
    // Taking an item OFF sale stays available to a suspended retailer — withdrawing supply is
    // never the thing suspension needs to prevent.
    if (status) await catalogItemsRepo.setStatus(db, params.id, status);

    const updated = await catalogItemsRepo.findById(db, params.id);
    return c.json({ item: updated ? itemView(updated) : null }, 200);
  })

  // ── Deals ───────────────────────────────────────────────────────────────────────────────────
  .get('/deals', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const rows = await dealsRepo.listByRetailer(db, r.id);
    return c.json(
      {
        deals: rows.map((d) => ({
          id: d.id,
          catalogItemId: d.catalogItemId,
          type: d.type,
          discountBps: d.discountBps,
          discountKobo: d.discountKobo === null ? null : (d.discountKobo as bigint).toString(),
          startsAt: d.startsAt.toISOString(),
          endsAt: d.endsAt.toISOString(),
          status: d.status,
        })),
      },
      200,
    );
  })
  .post('/deals', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    retailerAccessService.assertCanPublish(r);
    const body = await parseBody(c, DealSchema);
    if (body instanceof Response) return body;

    if (body.catalogItemId) {
      const item = await catalogItemsRepo.findById(db, body.catalogItemId);
      if (!item || item.retailerId !== r.id) throw new ForbiddenError('not_your_item');
    }
    const deal = await dealsService.createDeal(db, {
      retailerId: r.id,
      catalogItemId: body.catalogItemId ?? null,
      discountBps: body.discountBps ?? null,
      discountKobo: body.discountNaira == null ? null : kobo(body.discountNaira),
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
    });
    return c.json({ deal: { id: deal.id, status: deal.status } }, 201);
  })
  .patch('/deals/:id', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const params = parseParams(c, UUID);
    if (params instanceof Response) return params;
    const body = await parseBody(c, DealStatusSchema);
    if (body instanceof Response) return body;

    const deal = await dealsRepo.findById(db, params.id);
    if (!deal || deal.retailerId !== r.id) throw new ForbiddenError('not_your_deal');
    // `ended` is terminal — a deal's window is part of what buyers were shown, so it is not
    // restarted after the fact.
    if (deal.status === 'ended') throw new ForbiddenError('deal_already_ended');
    if (body.status === 'active') retailerAccessService.assertCanPublish(r);

    const updated = await dealsRepo.setStatus(db, params.id, body.status);
    return c.json({ deal: { id: params.id, status: updated?.status } }, 200);
  })

  // ── Redeem ──────────────────────────────────────────────────────────────────────────────────
  .post('/redeem', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    // A suspended retailer may still redeem: the buyer has already paid, and stranding them to
    // punish the retailer puts the cost on the wrong party. What this does refuse is a retailer
    // that never passed KYB — there is no verified account to settle into.
    retailerAccessService.assertCanRedeem(r);
    const body = await parseBody(c, RedeemSchema);
    if (body instanceof Response) return body;

    // `redeemService` row-locks the voucher, refuses one belonging to another retailer, and keys
    // the payout `redeem:<redemptionId>` so a double scan settles once. The retailer id passed
    // here is the AUTHORISED one, never a value from the request body.
    const out = await redeemService.redeem(db, anchorAdapterSingleton, {
      code: body.code,
      retailerId: r.id,
      now: new Date(),
      // Narration on the retailer's bank statement. The business name is what a retailer
      // reconciling their account will recognise; the voucher code makes the line traceable
      // back to a single redemption.
      householdRef: `${r.businessName} ${body.code}`.slice(0, 60),
    });
    return c.json(
      {
        payoutTransactionId: out.payoutTransactionId,
        status: out.status,
        // A synchronous payout rejection leaves the buyer's funds in suspense rather than
        // refunding them — surfaced so the portal can say "we could not pay you yet", not
        // "your customer was charged nothing".
        payoutFailed: out.payoutFailed ?? false,
      },
      200,
    );
  })

  // ── Orders & earnings ───────────────────────────────────────────────────────────────────────
  .get('/redemptions', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const q = parseQuery(c, PageSchema);
    if (q instanceof Response) return q;
    const rows = await redemptionsRepo.listByRetailer(db, r.id, q);
    return c.json(
      {
        redemptions: rows.map((x) => ({
          id: x.id,
          code: x.code,
          catalogItemId: x.catalogItemId,
          grossKobo: (x.grossKobo as bigint).toString(),
          discountedKobo: (x.discountedKobo as bigint).toString(),
          status: x.status,
          payoutStatus: x.payoutStatus,
          redeemedAt: x.redeemedAt?.toISOString() ?? null,
          createdAt: x.createdAt.toISOString(),
        })),
      },
      200,
    );
  })
  .get('/earnings', async (c) => {
    const r = await retailerAccessService.assertRetailerAccess(db, c.get('actor').userId);
    const q = parseQuery(c, PageSchema);
    if (q instanceof Response) return q;
    const [summary, history] = await Promise.all([
      earningsService.summary(db, r.id),
      earningsService.history(db, r.id, q),
    ]);
    return c.json(
      {
        // Settlement history, never a held balance: Amana holds no retailer funds — a redemption
        // pays out to the retailer's own bank account (spec §7).
        summary: {
          redeemedCount: summary.redeemedCount,
          grossKobo: summary.grossKobo.toString(),
          commissionKobo: summary.commissionKobo.toString(),
          netKobo: summary.netKobo.toString(),
          paidKobo: summary.paidKobo.toString(),
          pendingKobo: summary.pendingKobo.toString(),
        },
        history: history.map((h) => ({
          redemptionId: h.redemptionId,
          code: h.code,
          netKobo: h.netKobo.toString(),
          grossKobo: h.grossKobo.toString(),
          commissionKobo: h.commissionKobo.toString(),
          payoutStatus: h.payoutStatus,
          redeemedAt: h.redeemedAt?.toISOString() ?? null,
        })),
      },
      200,
    );
  });
