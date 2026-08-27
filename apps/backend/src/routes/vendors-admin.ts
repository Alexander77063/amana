import { SPEND_CATEGORIES } from '@amana/types';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { mintPrefixedCode } from '../lib/crockford';
import { parseBody, parseParams } from '../lib/validate';
import { adminAuth } from '../middleware/admin-auth';
import { auditRepo } from '../modules/audit/audit.repo';
import { householdsRepo } from '../modules/identity/households.repo';
import { phoneFingerprint } from '../modules/vendors/vendor-claim.service';
import { vendorClaimsRepo } from '../modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../modules/vendors/vendors.repo';

type DbOrTx = PostgresJsDatabase;

// Same shape as `routes/vendor-claim.ts`'s `PHONE_RE` — a local const rather than a shared import
// so the two routes stay independent, but a phone stored on `vendors.claimedByPhone` must meet
// the same bar whichever rail wrote it. The public rail's OTP round trip would catch a malformed
// number; this one has no such check, so the format gate has to be the schema.
const PHONE_RE = /^\+\d{10,15}$/;

/**
 * Zod needs a non-empty tuple; `SPEND_CATEGORIES` is the single source of the vocabulary. Derived
 * locally rather than importing the ready-made `SPEND_CATEGORY_VALUES`, which is `readonly
 * string[]` and so not assignable to `z.enum` — same reason `routes/retailer-portal.ts` re-derives.
 *
 * The ops rail is held to the SAME closed vocabulary as the public one: a category written here
 * lands as `categorySource: 'ops'`, the most enforceable source there is, and
 * `lifecycle.service.ts` substitutes it for the app-supplied category before `evaluateCategory`
 * runs. An off-vocabulary string typed by an operator would therefore silently deny every
 * allowlisted spend at that vendor, and pass every blocklist.
 */
const SPEND_CATEGORY_VALUES = SPEND_CATEGORIES.map((c) => c.value) as [string, ...string[]];

const IdParams = z.object({ id: z.string().uuid() });
const CategoryBody = z.object({ category: z.enum(SPEND_CATEGORY_VALUES).nullable() });
const EnforcementBody = z.object({ enforced: z.boolean().nullable() });
const ApproveBody = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  category: z.enum(SPEND_CATEGORY_VALUES).nullable(),
});

/**
 * Ops controls for the vendor registry. Mounted at `/vendors-admin`, behind the shared
 * `x-admin-api-key`.
 *
 * Deliberately NOT `jwtAuth`, and deliberately a separate route file from `/vendors` and
 * `/vendor-claim`: everything here is an operator action on registry state, and none of it may
 * ever touch a wallet, ledger or transaction — those authorize by user identity against
 * ownership, which a shared ops secret cannot express. `ADMIN_API_KEY` unset means deny, so a
 * misconfigured boot fails closed.
 *
 * `approve-claim` and `category` are deliberately powerful:
 *
 * - `approve-claim` mints a code and assigns a business identity on an operator's say-so — the
 *   escape hatch for the claim rail's 409 dead end (a real business account whose phone isn't the
 *   one NIBSS has on file for it). It records `ownership_proof` as `'ops'`, never `'phone_lookup'`,
 *   so the two trust levels stay distinguishable in the data forever after, and it writes an
 *   `audit_log` entry (`actorKind: 'ops'`, action `vendor.claim_approved_by_ops`) in the same
 *   transaction as the claim itself, per spec §7.1 — the most powerful action in this rail is not
 *   allowed to be the one that leaves no trace.
 * - `category` (`setOpsCategory`) outranks even a *claimed* category with no CAS guard at all —
 *   unlike `setObservedCategory`, which only wins against `observed`. That is correct here: an
 *   operator is correcting a business's own answer about itself, and that must always win. Both
 *   of these would be dangerously overpowered behind anything weaker than `adminAuth`.
 *
 * **Every mutating route here audits, in the same transaction as its write.** `approve-claim` is
 * not special: `category` silently overwrites a business's own answer about itself, `suspend` is
 * the documented remedy for a fraudulent one, and `enforcement` turns a whole household's registry
 * category locks on or off wholesale. A shared ops secret names no human, so the audit row is the
 * only record that any of this happened at all — and an audit written outside the write's own
 * transaction is a record that can survive a rollback, or be lost by one. Nothing is audited that
 * did not change a row: a 404 leaves no trace, because nothing happened.
 */
export const vendorsAdminRoute = new Hono()
  .use('*', async (c, next) => adminAuth(process.env.ADMIN_API_KEY)(c, next))

  .get('/claim-queue', async (c) => {
    const rows = await vendorClaimsRepo.listPendingForOps(db, new Date());
    return c.json({ attempts: rows }, 200);
  })

  .post('/vendors/:id/approve-claim', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, ApproveBody);
    if (body instanceof Response) return body;

    const publicCode = mintPrefixedCode('AMNV');
    const now = new Date();
    // One transaction: a vendor left `claimed` with its queue entry still `pending` is a phantom
    // ops-queue row for a business that no longer needs review.
    const claimed = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const claimedRow = await vendorsRepo.claim(txDb, {
        vendorId: params.id,
        phone: body.phone,
        category: body.category,
        publicCode,
        now,
      });
      if (!claimedRow) return null;

      // Resolve the queue entry this approval is for, if there is one — a hand-approval need not
      // have come through the public rail at all. `vendorId` is checked so an operator approving
      // vendor A can never resolve a pending attempt that actually belongs to vendor B, since
      // `findPendingByPhone` is keyed by phone alone.
      const attempt = await vendorClaimsRepo.findPendingByPhone(txDb, body.phone, now);
      if (attempt && attempt.vendorId === params.id) {
        await vendorClaimsRepo.markVerified(txDb, attempt.id, 'ops', now);
      }

      // Spec §7.1: an ops manual approval must be recorded in the audit log with the operator as
      // actor. `actorKind: 'ops'` (never `'system'`) so this is queryable as distinct from the
      // self-service `vendor.claimed` path — the whole point of the two trust levels is that they
      // stay separable after the fact. Same commit as the claim itself: an approval with no
      // record, or a record for an approval that rolled back, are both wrong.
      await auditRepo.append(txDb, {
        actorKind: 'ops',
        action: 'vendor.claim_approved_by_ops',
        subjectKind: 'vendor',
        subjectId: params.id,
        payloadJson: {
          claimantPhone: phoneFingerprint(body.phone),
          publicCode,
          category: body.category,
          ownershipProof: 'ops',
        },
      });
      return claimedRow;
    });
    if (!claimed) return c.json({ error: 'not_claimable' }, 409);
    return c.json({ publicCode, displayName: claimed.displayName }, 200);
  })

  .post('/vendors/:id/category', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, CategoryBody);
    if (body instanceof Response) return body;

    const ok = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      // Read before the write, inside the same transaction: `setOpsCategory` has no CAS, so this
      // audit row is the ONLY surviving record that a `claimed` category — the business's own
      // answer about itself — ever existed, and what it said.
      const before = await vendorsRepo.findById(txDb, params.id);
      const changed = await vendorsRepo.setOpsCategory(txDb, params.id, body.category);
      if (!changed) return false;
      await auditRepo.append(txDb, {
        actorKind: 'ops',
        action: 'vendor.category_set_by_ops',
        subjectKind: 'vendor',
        subjectId: params.id,
        payloadJson: {
          category: body.category,
          previousCategory: before?.category ?? null,
          previousCategorySource: before?.categorySource ?? null,
        },
      });
      return true;
    });
    return ok ? c.json({ ok: true }, 200) : c.json({ error: 'not_found' }, 404);
  })

  .post('/vendors/:id/suspend', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;

    const ok = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const before = await vendorsRepo.findById(txDb, params.id);
      const changed = await vendorsRepo.setStatus(txDb, params.id, 'suspended');
      if (!changed) return false;
      await auditRepo.append(txDb, {
        actorKind: 'ops',
        action: 'vendor.suspended_by_ops',
        subjectKind: 'vendor',
        subjectId: params.id,
        payloadJson: {
          // Named fields only, never the vendor row spread in: `vendors.claimedByPhone` must not
          // reach the audit log unfingerprinted, and a spread would put it there the day someone
          // adds a column. `previousStatus` distinguishes suspending a live claimed business from
          // suspending an account that was only ever `observed`.
          previousStatus: before?.status ?? null,
          previousCategorySource: before?.categorySource ?? null,
        },
      });
      return true;
    });
    return ok ? c.json({ ok: true }, 200) : c.json({ error: 'not_found' }, 404);
  })

  .post('/households/:id/enforcement', async (c) => {
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, EnforcementBody);
    if (body instanceof Response) return body;

    const ok = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const before = await householdsRepo.findById(txDb, params.id);
      const changed = await householdsRepo.setVendorCategoryEnforced(
        txDb,
        params.id,
        body.enforced,
      );
      if (!changed) return false;
      await auditRepo.append(txDb, {
        actorKind: 'ops',
        // Subject is the HOUSEHOLD, not a vendor — this switch is scoped to one household and
        // touches every vendor it ever pays. The action keeps the `vendor.*` namespace anyway, so
        // the whole registry rail stays queryable as one thing.
        action: 'vendor.enforcement_set_by_ops',
        subjectKind: 'household',
        subjectId: params.id,
        payloadJson: {
          // Written unconditionally, never conditionally spread: `null` ("inherit the global
          // default") is a distinct commitment from `false` ("never, until someone changes it
          // back"), and an omitted key would make the two indistinguishable after the fact.
          enforced: body.enforced,
          previousEnforced: before?.vendorCategoryEnforced ?? null,
        },
      });
      return true;
    });
    return ok ? c.json({ ok: true }, 200) : c.json({ error: 'not_found' }, 404);
  });
