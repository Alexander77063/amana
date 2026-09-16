import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { supportVerifications } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type SupportVerificationRow = typeof supportVerifications.$inferSelect;
export type SupportRail = 'push' | 'sms' | 'none';

export type CreateSupportVerification = {
  adminUserId: string;
  phoneE164: string;
  userId: string | null;
  rail: SupportRail;
  matchNumber: number | null;
  codeHash: string | null;
  expiresAt: Date;
};

/**
 * Queries against `support_verifications`. No policy lives here — which rail to use, whether a cap
 * has been breached and whether a session is still live are all the service's business. This file
 * only knows how to read and write rows.
 */
export const supportVerificationsRepo = {
  async create(db: DbOrTx, input: CreateSupportVerification): Promise<SupportVerificationRow> {
    const [row] = await db.insert(supportVerifications).values(input).returning();
    // `noUncheckedIndexedAccess` makes this `T | undefined`. Guard rather than assert, matching
    // `auditRepo.append` and `adminUsersRepo.recordSignIn`.
    if (!row) throw new Error('supportVerifications.create returned no row');
    return row;
  },

  /**
   * Switch a still-pending PUSH verification onto the SMS rail, after Expo accepted none of the
   * customer's tokens. Pending-only, so a verification already answered by a tap is never reopened
   * by a late fallback.
   */
  async attachSmsFallback(
    db: DbOrTx,
    id: string,
    input: { codeHash: string },
  ): Promise<SupportVerificationRow | null> {
    const [row] = await db
      .update(supportVerifications)
      .set({ rail: 'sms', codeHash: input.codeHash, matchNumber: null })
      .where(and(eq(supportVerifications.id, id), eq(supportVerifications.status, 'pending')))
      .returning();
    return row ?? null;
  },

  async findById(db: DbOrTx, id: string): Promise<SupportVerificationRow | null> {
    const [row] = await db
      .select()
      .from(supportVerifications)
      .where(eq(supportVerifications.id, id))
      .limit(1);
    return row ?? null;
  },

  /**
   * Verify a row, but only while it is still pending.
   *
   * The `status = 'pending'` predicate is a concurrency guard, not decoration: two responses
   * racing must not both verify, and a row that has already been denied must never be
   * resurrected. A caller that gets `null` back lost the race or arrived after a denial.
   */
  async markVerified(
    db: DbOrTx,
    id: string,
    sessionExpiresAt: Date,
  ): Promise<SupportVerificationRow | null> {
    const [row] = await db
      .update(supportVerifications)
      .set({ status: 'verified', verifiedAt: new Date(), sessionExpiresAt })
      .where(and(eq(supportVerifications.id, id), eq(supportVerifications.status, 'pending')))
      .returning();
    return row ?? null;
  },

  /** Deny a row, on the same pending-only terms as `markVerified`. */
  async markDenied(db: DbOrTx, id: string): Promise<SupportVerificationRow | null> {
    const [row] = await db
      .update(supportVerifications)
      .set({ status: 'denied' })
      .where(and(eq(supportVerifications.id, id), eq(supportVerifications.status, 'pending')))
      .returning();
    return row ?? null;
  },

  /** Incremented in the database rather than read-modify-write, so concurrent attempts both count. */
  async incrementAttempts(db: DbOrTx, id: string): Promise<number> {
    const [row] = await db
      .update(supportVerifications)
      .set({ attempts: sql`${supportVerifications.attempts} + 1` })
      .where(eq(supportVerifications.id, id))
      .returning({ attempts: supportVerifications.attempts });
    return row?.attempts ?? 0;
  },

  /**
   * How many verifications this operator started since `since`. Counted here rather than in the
   * in-memory rate limiter because an hourly or daily cap that resets on every deploy is not a cap.
   */
  async countByOperatorSince(db: DbOrTx, adminUserId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(supportVerifications)
      .where(
        and(
          eq(supportVerifications.adminUserId, adminUserId),
          gte(supportVerifications.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  },

  /**
   * How many verifications were aimed at this phone since `since`, across ALL operators. The
   * "across all operators" part is the point: a cap one member of staff can walk around by asking
   * a colleague is not a cap.
   */
  async countByPhoneSince(db: DbOrTx, phoneE164: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(supportVerifications)
      .where(
        and(
          eq(supportVerifications.phoneE164, phoneE164),
          gte(supportVerifications.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  },
};
