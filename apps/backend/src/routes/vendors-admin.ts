import { SPEND_CATEGORIES } from '@amana/types';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { mintPrefixedCode } from '../lib/crockford';
import { parseBody, parseParams } from '../lib/validate';
import { type AdminActorVariables, adminSession } from '../middleware/admin-session';
import { adminIamService } from '../modules/admin/admin-iam.service';
import { adminOpsApprovalService } from '../modules/admin/admin-ops-approval.service';
import { auditRepo } from '../modules/audit/audit.repo';
import { householdsRepo } from '../modules/identity/households.repo';
import { phoneFingerprint } from '../modules/vendors/vendor-claim.service';
import { vendorClaimsRepo } from '../modules/vendors/vendor-claims.repo';
import { vendorConsentService } from '../modules/vendors/vendor-consent.service';
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
 * Ops controls for the vendor registry. Mounted at `/vendors-admin`, behind `adminSession()` and
 * a per-endpoint permission check.
 *
 * **The shared `x-admin-api-key` is gone** (sub-plan A1 Task 4). It was one static secret, held by
 * everyone, naming nobody: rotating it locked out the whole team, and the audit rows below could
 * only record that *somebody* approved a claim. Every route here now requires a signed-in member
 * of staff holding `vendor.read` or `vendor.write`, and there is deliberately **no fallback** to
 * the old key — a fallback would be the original vulnerability with extra steps.
 *
 * Deliberately NOT `jwtAuth`, and deliberately a separate route file from `/vendors` and
 * `/vendor-claim`: everything here is an operator action on registry state, and none of it may
 * ever touch a wallet, ledger or transaction — those authorize by user identity against
 * ownership, which staff authority does not confer.
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
 *   of these would be dangerously overpowered behind anything weaker than a named, revocable
 *   staff session.
 *
 * **Every mutating route here audits, in the same transaction as its write.** `approve-claim` is
 * not special: `category` silently overwrites a business's own answer about itself, `suspend` is
 * the documented remedy for a fraudulent one, and `enforcement` turns a whole household's registry
 * category locks on or off wholesale. Since Task 4 those rows also carry `actorAdminUserId`, so
 * they finally name the operator rather than only the fact of an operator — and an audit written
 * outside the write's own
 * transaction is a record that can survive a rollback, or be lost by one. Nothing is audited that
 * did not change a row: a 404 leaves no trace, because nothing happened.
 */
/** Only these two purposes exist, and a revocation names exactly one — see `vendor-consents.ts`. */
const RevokeConsentSchema = z.object({
  purpose: z.enum(['service_terms', 'lender_introduction']),
});

export const vendorsAdminRoute = new Hono<{ Variables: AdminActorVariables }>()
  .use('*', adminSession())

  .get('/claim-queue', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.read');
    const rows = await vendorClaimsRepo.listPendingForOps(db, new Date());
    return c.json({ attempts: rows }, 200);
  })

  /**
   * PROPOSE a claim approval. Since sub-plan A1 Task 4B this does not claim anything: it mints a
   * public code and assigns a business identity, i.e. hands ownership of a bank account to whoever
   * the operator names, so it takes a second admin to complete at `/admin/approvals/:id/approve`.
   *
   * It is the ONLY ops action gated this way. `suspend` and `consents/revoke` stay immediate —
   * they remove standing rather than create it, and delaying them is the harmful direction.
   */
  .post('/vendors/:id/approve-claim', async (c) => {
    const actor = c.get('adminActor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, ApproveBody);
    if (body instanceof Response) return body;

    const proposal = await adminOpsApprovalService.proposeClaimApproval(db, {
      actorAdminUserId: actor.adminUserId,
      vendorId: params.id,
      phone: body.phone,
      category: body.category,
    });
    return c.json({ approvalId: proposal.id, status: proposal.status }, 202);
  })

  .post('/vendors/:id/category', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.write');
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
        actorAdminUserId: actor.adminUserId,
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
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.write');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;

    const ok = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const before = await vendorsRepo.findById(txDb, params.id);
      const changed = await vendorsRepo.setStatus(txDb, params.id, 'suspended');
      if (!changed) return false;
      await auditRepo.append(txDb, {
        actorKind: 'ops',
        actorAdminUserId: actor.adminUserId,
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

  /**
   * Withdraw a consent, or read the log.
   *
   * NDPA 2023 requires withdrawal to be **as easy as granting**, and today the only channel a
   * merchant has is a phone call to ops — there is no merchant-facing session on this rail, and the
   * claim OTP is spent at claim time. So an operator records it on their behalf, with `source:
   * 'ops'` marking exactly that provenance. A self-serve path is the right end state and is noted
   * in the runbook; until it exists, this is the withdrawal mechanism and support must know it.
   */
  .get('/vendors/:id/consents', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.read');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const [state, history] = await Promise.all([
      vendorConsentService.currentState(db, params.id),
      vendorConsentService.history(db, params.id),
    ]);
    return c.json({ current: state, history }, 200);
  })

  .post('/vendors/:id/consents/revoke', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.write');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, RevokeConsentSchema);
    if (body instanceof Response) return body;

    const vendor = await vendorsRepo.findById(db, params.id);
    if (!vendor) return c.json({ error: 'not_found' }, 404);

    await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      await vendorConsentService.revoke(txDb, {
        vendorId: params.id,
        purpose: body.purpose,
        source: 'ops',
        now: new Date(),
      });
      await auditRepo.append(txDb, {
        actorKind: 'ops',
        actorAdminUserId: actor.adminUserId,
        action: 'vendor.consent_revoked_by_ops',
        subjectKind: 'vendor',
        subjectId: params.id,
        payloadJson: { purpose: body.purpose },
      });
    });
    return c.json({ ok: true }, 200);
  })

  .post('/households/:id/enforcement', async (c) => {
    const actor = c.get('adminActor');
    // `vendor.write`, even though the row written is a HOUSEHOLD row — the one permission mapping
    // in this file that is not obvious, so it is argued rather than assumed.
    //
    // The role matrix gives `ops` the vendor registry and explicitly withholds unrestricted
    // customer data. This endpoint sets a single tri-state boolean, `vendorCategoryEnforced`,
    // which decides whether the vendor registry's category rules apply to that household. It is
    // the registry's rollout switch: it reads nothing about the household, exposes no balance,
    // transaction, name or identifier, and its only effect is on how vendor categories are
    // enforced. So it is vendor-registry authority pointed at one household, not customer-data
    // access, and it belongs with the rest of the registry controls.
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.write');
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
        actorAdminUserId: actor.adminUserId,
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
