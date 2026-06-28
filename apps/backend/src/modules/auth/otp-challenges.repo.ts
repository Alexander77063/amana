import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { phoneOtpChallenges } from '../../db/schema';
import type { OtpChallengeRow, OtpPurpose } from './types';

type DbOrTx = PostgresJsDatabase;

export type InsertChallengeInput = {
  phone: string;
  codeHash: string;
  purpose: OtpPurpose;
  expiresAt: Date;
};

export const otpChallengesRepo = {
  async insert(db: DbOrTx, input: InsertChallengeInput): Promise<OtpChallengeRow> {
    const [row] = await db.insert(phoneOtpChallenges).values(input).returning();
    if (!row) throw new Error('otpChallenges.insert returned no row');
    return row;
  },

  async findActiveByPhone(
    db: DbOrTx,
    phone: string,
    now: Date,
  ): Promise<OtpChallengeRow | undefined> {
    const [row] = await db
      .select()
      .from(phoneOtpChallenges)
      .where(
        and(
          eq(phoneOtpChallenges.phone, phone),
          isNull(phoneOtpChallenges.consumedAt),
          gt(phoneOtpChallenges.expiresAt, now),
        ),
      )
      .limit(1);
    return row;
  },

  async incrementAttempts(db: DbOrTx, id: string): Promise<number> {
    const [row] = await db
      .update(phoneOtpChallenges)
      .set({ attempts: sql`${phoneOtpChallenges.attempts} + 1` })
      .where(eq(phoneOtpChallenges.id, id))
      .returning({ attempts: phoneOtpChallenges.attempts });
    return row?.attempts ?? 0;
  },

  /**
   * Atomically claim one verification attempt: increments `attempts` only if the
   * challenge is still active and under the cap, in a single statement. Returns
   * the new count, or undefined if the slot couldn't be claimed (at cap /
   * consumed / expired) — so concurrent verifies can't exceed the cap.
   */
  async claimAttempt(
    db: DbOrTx,
    id: string,
    maxAttempts: number,
    now: Date,
  ): Promise<number | undefined> {
    const [row] = await db
      .update(phoneOtpChallenges)
      .set({ attempts: sql`${phoneOtpChallenges.attempts} + 1` })
      .where(
        and(
          eq(phoneOtpChallenges.id, id),
          isNull(phoneOtpChallenges.consumedAt),
          gt(phoneOtpChallenges.expiresAt, now),
          sql`${phoneOtpChallenges.attempts} < ${maxAttempts}`,
        ),
      )
      .returning({ attempts: phoneOtpChallenges.attempts });
    return row?.attempts;
  },

  async markConsumed(db: DbOrTx, id: string, now: Date): Promise<void> {
    await db
      .update(phoneOtpChallenges)
      .set({ consumedAt: now })
      .where(eq(phoneOtpChallenges.id, id));
  },

  async invalidateActiveForPhone(db: DbOrTx, phone: string, now: Date): Promise<number> {
    const result = await db
      .update(phoneOtpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(phoneOtpChallenges.phone, phone), isNull(phoneOtpChallenges.consumedAt)));
    return result.length ?? 0;
  },
};
