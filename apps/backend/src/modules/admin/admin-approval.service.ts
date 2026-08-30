import { and, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { adminApprovals } from '../../db/schema';
import { env } from '../../env';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';

type DbOrTx = PostgresJsDatabase;

export type AdminApprovalRow = typeof adminApprovals.$inferSelect;
export type AdminApprovalKind = AdminApprovalRow['kind'];

export type ProposeInput = {
  kind: AdminApprovalKind;
  makerAdminUserId: string;
  payload: Record<string, unknown>;
  reason?: string | null;
  /**
   * Decide and apply in the same call, with maker and checker recorded as the same account.
   *
   * The ONLY caller that may pass this is the config-seeded bootstrap account (see
   * `admin-iam.service`), and the decision of whether it may is made there, not here.
   */
  selfApprove?: boolean;
};

/**
 * Generic maker-checker. Deliberately knows nothing about roles.
 *
 * It records that somebody proposed something, and that somebody else decided it. What the
 * "something" means, and what applying it does, belongs to the caller — `admin-iam.service`
 * orchestrates role grants on top of this. Keeping the two apart is what lets Task 4 put vendor
 * suspensions and claim approvals through the same control without this file learning about
 * vendors.
 */
export const adminApprovalService = {
  async findById(db: DbOrTx, id: string): Promise<AdminApprovalRow | null> {
    const [row] = await db.select().from(adminApprovals).where(eq(adminApprovals.id, id)).limit(1);
    return row ?? null;
  },

  async listPending(db: DbOrTx): Promise<AdminApprovalRow[]> {
    return db.select().from(adminApprovals).where(eq(adminApprovals.status, 'pending'));
  },

  async propose(
    db: DbOrTx,
    input: ProposeInput,
    now: Date = new Date(),
  ): Promise<AdminApprovalRow> {
    const expiresAt = new Date(now.getTime() + env.ADMIN_APPROVAL_TTL_SECONDS * 1000);
    const [row] = await db
      .insert(adminApprovals)
      .values({
        kind: input.kind,
        payloadJson: input.payload,
        makerAdminUserId: input.makerAdminUserId,
        reason: input.reason ?? null,
        expiresAt,
        ...(input.selfApprove
          ? {
              status: 'approved' as const,
              checkerAdminUserId: input.makerAdminUserId,
              decidedAt: now,
              decisionReason: 'bootstrap exemption: config-provisioned account',
            }
          : {}),
      })
      .returning();
    if (!row) throw new Error('adminApprovals.propose returned no row');

    await auditRepo.append(
      db,
      auditEvents.adminApprovalChanged({
        approvalId: row.id,
        actorAdminUserId: input.makerAdminUserId,
        event: 'proposed',
        kind: input.kind,
        payload: input.payload,
        at: now,
      }),
    );
    if (input.selfApprove) {
      await auditRepo.append(
        db,
        auditEvents.adminApprovalChanged({
          approvalId: row.id,
          actorAdminUserId: input.makerAdminUserId,
          event: 'approved',
          kind: input.kind,
          payload: { ...input.payload, bootstrapExemption: true },
          at: now,
        }),
      );
    }
    return row;
  },

  /**
   * Claim a pending proposal on behalf of `checkerAdminUserId`.
   *
   * The status transition is a conditional UPDATE, so two checkers racing on the same proposal
   * cannot both win and apply the action twice. The caller applies the action only if this
   * returns a row.
   */
  async approve(
    db: DbOrTx,
    input: { approvalId: string; checkerAdminUserId: string; reason?: string | null },
    now: Date = new Date(),
  ): Promise<AdminApprovalRow> {
    const existing = await adminApprovalService.findById(db, input.approvalId);
    if (!existing) throw new NotFoundError('approval_not_found');

    // The rule this whole table exists for. Two different people, and the maker cannot be one of
    // them twice — checked before anything else so the reason is never ambiguous.
    if (existing.makerAdminUserId === input.checkerAdminUserId) {
      throw new ForbiddenError('maker_cannot_be_checker');
    }

    const [row] = await db
      .update(adminApprovals)
      .set({
        status: 'approved',
        checkerAdminUserId: input.checkerAdminUserId,
        decidedAt: now,
        decisionReason: input.reason ?? null,
      })
      .where(and(eq(adminApprovals.id, input.approvalId), eq(adminApprovals.status, 'pending')))
      .returning();
    // Already decided, cancelled or swept. Never re-open: a decided proposal is history.
    if (!row) throw new ConflictError('approval_not_pending');
    if (row.expiresAt <= now) throw new ConflictError('approval_expired');

    await auditRepo.append(
      db,
      auditEvents.adminApprovalChanged({
        approvalId: row.id,
        actorAdminUserId: input.checkerAdminUserId,
        event: 'approved',
        kind: row.kind,
        payload: row.payloadJson as Record<string, unknown>,
        at: now,
      }),
    );
    return row;
  },

  async reject(
    db: DbOrTx,
    input: { approvalId: string; checkerAdminUserId: string; reason?: string | null },
    now: Date = new Date(),
  ): Promise<AdminApprovalRow> {
    const existing = await adminApprovalService.findById(db, input.approvalId);
    if (!existing) throw new NotFoundError('approval_not_found');
    if (existing.makerAdminUserId === input.checkerAdminUserId) {
      throw new ForbiddenError('maker_cannot_be_checker');
    }

    const [row] = await db
      .update(adminApprovals)
      .set({
        status: 'rejected',
        checkerAdminUserId: input.checkerAdminUserId,
        decidedAt: now,
        decisionReason: input.reason ?? null,
      })
      .where(and(eq(adminApprovals.id, input.approvalId), eq(adminApprovals.status, 'pending')))
      .returning();
    if (!row) throw new ConflictError('approval_not_pending');

    await auditRepo.append(
      db,
      auditEvents.adminApprovalChanged({
        approvalId: row.id,
        actorAdminUserId: input.checkerAdminUserId,
        event: 'rejected',
        kind: row.kind,
        payload: row.payloadJson as Record<string, unknown>,
        at: now,
      }),
    );
    return row;
  },

  /** Withdraw your own proposal. Only the maker may, and only while it is still pending. */
  async cancel(
    db: DbOrTx,
    input: { approvalId: string; makerAdminUserId: string },
    now: Date = new Date(),
  ): Promise<AdminApprovalRow> {
    const existing = await adminApprovalService.findById(db, input.approvalId);
    if (!existing) throw new NotFoundError('approval_not_found');
    if (existing.makerAdminUserId !== input.makerAdminUserId) {
      throw new ForbiddenError('only_the_maker_may_cancel');
    }

    const [row] = await db
      .update(adminApprovals)
      .set({ status: 'cancelled', decidedAt: now })
      .where(and(eq(adminApprovals.id, input.approvalId), eq(adminApprovals.status, 'pending')))
      .returning();
    if (!row) throw new ConflictError('approval_not_pending');

    await auditRepo.append(
      db,
      auditEvents.adminApprovalChanged({
        approvalId: row.id,
        actorAdminUserId: input.makerAdminUserId,
        event: 'cancelled',
        kind: row.kind,
        payload: row.payloadJson as Record<string, unknown>,
        at: now,
      }),
    );
    return row;
  },

  /**
   * Expire proposals nobody decided. Called by cron.
   *
   * The transition is WRITTEN rather than computed at read time — the same reason
   * `bump-ttl-sweep` exists. A `pending` row that has silently stopped working is a row an
   * operator will keep trying to approve, with no explanation of why nothing happens.
   */
  async sweepExpired(db: DbOrTx, now: Date = new Date()): Promise<number> {
    const rows = await db
      .update(adminApprovals)
      .set({ status: 'expired', decidedAt: now })
      .where(and(eq(adminApprovals.status, 'pending'), lt(adminApprovals.expiresAt, now)))
      .returning({ id: adminApprovals.id, kind: adminApprovals.kind });

    for (const row of rows) {
      await auditRepo.append(
        db,
        auditEvents.adminApprovalChanged({
          approvalId: row.id,
          actorAdminUserId: null,
          event: 'expired',
          kind: row.kind,
          payload: {},
          at: now,
        }),
      );
    }
    return rows.length;
  },
};
