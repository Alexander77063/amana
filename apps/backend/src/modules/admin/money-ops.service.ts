import { and, asc, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { env } from '../../env';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { auditRepo } from '../audit';
import { reversalService } from '../transactions/reversal.service';
import { settlementService } from '../transactions/settlement.service';
import { transactionsRepo } from '../wallet/transactions.repo';
import { adminElevationsRepo } from './admin-elevations.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * The reversal reason recorded when Anchor has no record at all.
 *
 * A fixed system string, never the operator's words: `reversalService.reverse` writes this onto
 * the ORIGINAL transaction's `error_message`, so the operator's justification would end up on a
 * customer's transaction record. That justification belongs on `admin_elevations.reason` and in
 * the audit payload.
 */
const NO_ANCHOR_RECORD_REASON = 'no Anchor record past the force-reverse threshold';

/**
 * How many stuck transactions the queue returns at once. A human resolves these one at a time with
 * a typed reason apiece, so a page far beyond this is unreadable anyway — and a queue this long is
 * itself the signal to call Anchor rather than to start clicking.
 */
const STUCK_LIST_LIMIT = 200;

/**
 * The audit actions this surface writes. Collected here rather than scattered as literals, and
 * deliberately not builders in `events.ts`: this service is their only writer, and an indirection
 * layer with one caller is harder to read than the call it hides.
 *
 * `money.force_reversed` is distinct from `money.resolve_reversed` on purpose — it is the only
 * place a human decides money moves without counterparty confirmation, and an auditor must be able
 * to find those without reading payloads.
 */
export const MONEY_AUDIT = {
  elevationGranted: 'money.elevation_granted',
  resolveSettled: 'money.resolve_settled',
  resolveReversed: 'money.resolve_reversed',
  forceReversed: 'money.force_reversed',
  resolveRefused: 'money.resolve_refused',
} as const;

/** Every way this surface can say no. The route maps each to a status; nothing else refuses. */
export type MoneyOpsRefusal =
  | 'elevation_required'
  | 'elevation_expired'
  | 'not_stuck'
  | 'too_early'
  | 'still_pending'
  | 'anchor_unreachable';

const REFUSAL_STATUS: Record<MoneyOpsRefusal, 403 | 409 | 503> = {
  elevation_required: 403,
  elevation_expired: 403,
  not_stuck: 409,
  too_early: 409,
  still_pending: 409,
  anchor_unreachable: 503,
};

export class MoneyOpsError extends Error {
  readonly httpStatus: 403 | 409 | 503;
  constructor(readonly code: MoneyOpsRefusal) {
    super(`money operation refused: ${code}`);
    this.name = 'MoneyOpsError';
    this.httpStatus = REFUSAL_STATUS[code];
  }
}

export type GrantElevationInput = {
  actorAdminUserId: string;
  transactionId: string;
  reason: string;
  now: Date;
};

export type ResolveInput = {
  actorAdminUserId: string;
  transactionId: string;
  now: Date;
};

export const moneyOpsService = {
  /**
   * Open a window in which an operator who ALREADY holds `money.operate` may use it against one
   * transaction. The caller has verified that permission; this function never widens anyone's
   * access, which is why an `admin` cannot reach the operation by obtaining one of these rows.
   *
   * State rules deliberately live in `resolveStuckTransaction`, not here: one place decides whether
   * a transaction may be touched, so the two cannot drift. An elevation raised against a
   * transaction that turns out not to be stuck is simply refused at resolve time.
   */
  async grantElevation(
    db: DbOrTx,
    input: GrantElevationInput,
  ): Promise<{ elevationId: string; expiresAt: Date }> {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new Error('elevation reason is required');

    const expiresAt = new Date(input.now.getTime() + env.MONEY_ELEVATION_SECONDS * 1000);
    const row = await adminElevationsRepo.create(db, {
      adminUserId: input.actorAdminUserId,
      transactionId: input.transactionId,
      reason,
      expiresAt,
    });

    await auditRepo.append(db, {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action: MONEY_AUDIT.elevationGranted,
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: { reason, expiresAt: expiresAt.toISOString() },
    });

    return { elevationId: row.id, expiresAt };
  },

  /**
   * The stuck queue: `in_flight` spends old enough that a human may look at them.
   *
   * Capped. The incident this whole feature exists for — a reference or reconciliation fault at
   * Anchor — produces many stuck rows at once, which is precisely when an uncapped query would be
   * at its most expensive. Oldest first, because those have been stuck longest.
   */
  async listStuck(db: DbOrTx, now: Date, limit: number = STUCK_LIST_LIMIT) {
    const cutoff = new Date(now.getTime() - env.STUCK_TXN_MIN_AGE_SECONDS * 1000);
    return db
      .select({
        id: transactions.id,
        amountKobo: transactions.amountKobo,
        createdAt: transactions.createdAt,
        vendorResolvedName: transactions.vendorResolvedName,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'in_flight'),
          eq(transactions.kind, 'spend'),
          lt(transactions.createdAt, cutoff),
        ),
      )
      .orderBy(asc(transactions.createdAt))
      .limit(limit);
  },

  /**
   * Resolve one stuck transaction by asking Anchor what happened and applying the answer.
   *
   * The operator supplies authority and a reason; Anchor supplies the outcome. Settlement and
   * reversal go through the SAME functions the reconciliation cron calls, so the manual and
   * automated paths cannot drift, and concurrency is already handled: both take
   * `SELECT … FOR UPDATE` and refuse a non-`in_flight` row.
   */
  async resolveStuckTransaction(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: ResolveInput,
  ): Promise<{ outcome: 'settled' | 'reversed' }> {
    // Audits the refusal and hands back the error to throw, so every `no` is on the record.
    // Deliberately writes on `db` rather than inside a transaction: a refusal audit that rolls
    // back with the refusal is not an audit.
    const refuse = async (code: MoneyOpsRefusal): Promise<MoneyOpsError> => {
      await auditRepo.append(db, {
        actorKind: 'ops',
        actorAdminUserId: input.actorAdminUserId,
        action: MONEY_AUDIT.resolveRefused,
        subjectKind: 'transaction',
        subjectId: input.transactionId,
        payloadJson: { code },
      });
      return new MoneyOpsError(code);
    };

    const elevation = await adminElevationsRepo.findLive(
      db,
      input.actorAdminUserId,
      input.transactionId,
      input.now,
    );
    if (!elevation) throw await refuse('elevation_required');

    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn || txn.status !== 'in_flight') throw await refuse('not_stuck');

    const minAgeCutoff = new Date(input.now.getTime() - env.STUCK_TXN_MIN_AGE_SECONDS * 1000);
    if (txn.createdAt >= minAgeCutoff) throw await refuse('too_early');

    let remote: Awaited<ReturnType<AnchorAdapter['findTransferByReference']>>;
    try {
      remote = await adapter.findTransferByReference(txn.idempotencyKey);
    } catch {
      // A failed call is NOT an absent record. The adapter returns null only on a definitive 404;
      // everything else throws. Treating a throw as absence would let an Anchor outage trigger
      // reversals for transfers that actually completed.
      throw await refuse('anchor_unreachable');
    }

    let action: string;
    let outcome: 'settled' | 'reversed';

    if (remote === null) {
      const forceCutoff = new Date(
        input.now.getTime() - env.STUCK_TXN_FORCE_REVERSE_AGE_SECONDS * 1000,
      );
      if (txn.createdAt >= forceCutoff) throw await refuse('too_early');
      // Reverse ONLY. This path can never settle, so a wrong call here can never pay a vendor
      // twice — it can only return money to the customer.
      await reversalService.reverse(db, {
        transactionId: txn.id,
        reason: NO_ANCHOR_RECORD_REASON,
        failedAt: input.now,
      });
      action = MONEY_AUDIT.forceReversed;
      outcome = 'reversed';
    } else if (remote.status === 'COMPLETED') {
      await settlementService.finalise(db, {
        transactionId: txn.id,
        nibssSessionId: remote.nibssSessionId ?? null,
        settledAt: input.now,
      });
      action = MONEY_AUDIT.resolveSettled;
      outcome = 'settled';
    } else if (remote.status === 'FAILED') {
      // Anchor's reason, not the operator's: a manually resolved reversal must be
      // indistinguishable from an automatic one on the transaction record.
      await reversalService.reverse(db, {
        transactionId: txn.id,
        reason: remote.failureReason ?? null,
        failedAt: input.now,
      });
      action = MONEY_AUDIT.resolveReversed;
      outcome = 'reversed';
    } else {
      throw await refuse('still_pending');
    }

    // Only now, after the money has actually moved. A failure above leaves the elevation live, so
    // a retry needs no fresh justification for work that never happened.
    await adminElevationsRepo.markConsumed(db, elevation.id, input.now);
    await auditRepo.append(db, {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action,
      subjectKind: 'transaction',
      subjectId: txn.id,
      payloadJson: { elevationId: elevation.id, anchorStatus: remote?.status ?? 'no_record' },
    });

    return { outcome };
  },
};
