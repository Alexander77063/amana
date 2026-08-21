import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { AnchorHttpError } from '../integrations/anchor/client';
import { NotFoundError } from '../lib/errors';
import { parseBody, parseParams, parseQuery } from '../lib/validate';
import { adminAuth } from '../middleware/admin-auth';
import { retailerOnboardingService } from '../modules/marketplace/retailer-onboarding.service';
import { retailersRepo } from '../modules/marketplace/retailers.repo';

const ApplySchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  payoutBankCode: z.string().regex(/^\d{3,6}$/, 'payoutBankCode must be 3-6 digits'),
  payoutAccountNumber: z.string().regex(/^\d{10}$/, 'payoutAccountNumber must be 10 digits'),
});

const KybSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/, 'bvn must be 11 digits'),
  rcNumber: z.string().trim().min(1).max(50).optional(),
  email: z.string().email().optional(),
});

const IdParamSchema = z.object({ id: z.string().uuid() });

const ListQuerySchema = z.object({
  status: z.enum(['applied', 'kyb_pending', 'approved', 'suspended']).default('applied'),
});

/**
 * Ops-only retailer onboarding surface. Retailer-facing auth (and the portal UI) is SP4b.
 *
 * `ADMIN_API_KEY` is read from `process.env` per request — the same contract as the Anchor
 * webhook secret in `routes/webhooks.ts` — so tests can set it between calls. Its shape is
 * still validated (and boot-enforced in production) by `env.ts`.
 *
 * These routes touch retailer onboarding state ONLY. A shared ops key is not an identity, so
 * it must never reach a wallet, ledger, or transaction path, where authorization is by user
 * identity vs. ownership.
 */
export const retailersRoute = new Hono()
  .use('*', async (c, next) => adminAuth(process.env.ADMIN_API_KEY)(c, next))

  .post('/', async (c) => {
    const body = await parseBody(c, ApplySchema);
    if (body instanceof Response) return body;
    const retailer = await retailerOnboardingService.apply(db, body);
    return c.json(retailer, 201);
  })

  .get('/', async (c) => {
    const query = parseQuery(c, ListQuerySchema);
    if (query instanceof Response) return query;
    return c.json(await retailersRepo.listByOnboardingStatus(db, query.status));
  })

  .get('/:id', async (c) => {
    const params = parseParams(c, IdParamSchema);
    if (params instanceof Response) return params;
    const retailer = await retailersRepo.findById(db, params.id);
    if (!retailer) throw new NotFoundError(`retailer ${params.id} not found`);
    return c.json(retailer);
  })

  .post('/:id/kyb', async (c) => {
    const params = parseParams(c, IdParamSchema);
    if (params instanceof Response) return params;
    const body = await parseBody(c, KybSchema);
    if (body instanceof Response) return body;
    try {
      const retailer = await retailerOnboardingService.submitKyb(
        db,
        params.id,
        body,
        anchorAdapterSingleton,
      );
      return c.json(retailer);
    } catch (e) {
      // Same contract as POST /households: an Anchor outage is upstream-unavailable, not a
      // 500. The retailer stays in its current status, so the submit is safely retryable.
      if (e instanceof AnchorHttpError) return c.json({ error: 'anchor_unavailable' }, 503);
      throw e;
    }
  })

  .post('/:id/approve', async (c) => {
    const params = parseParams(c, IdParamSchema);
    if (params instanceof Response) return params;
    return c.json(await retailerOnboardingService.approve(db, params.id));
  })

  .post('/:id/suspend', async (c) => {
    const params = parseParams(c, IdParamSchema);
    if (params instanceof Response) return params;
    return c.json(await retailerOnboardingService.suspend(db, params.id));
  });
