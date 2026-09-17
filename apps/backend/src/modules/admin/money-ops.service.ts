import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { auditRepo } from '../audit';
import { adminElevationsRepo } from './admin-elevations.repo';

type DbOrTx = PostgresJsDatabase;

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
};
