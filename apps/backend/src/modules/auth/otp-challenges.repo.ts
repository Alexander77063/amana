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
