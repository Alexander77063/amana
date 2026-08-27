import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
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

  /**
   * The active challenge for a phone, PREFERRING one whose purpose the caller accepts.
   *
   * A phone can now hold one live challenge per purpose (see the partial unique index on
   * `phone_otp_challenges`), so an unordered `limit 1` could hand `verifyCode` a `vendor_claim`
   * row while the user is submitting a perfectly correct `login` code, and the login would be
   * rejected. Ordering by "is this a purpose the caller accepts" fixes that.
   *
   * Deliberately a preference and not a filter: when the only live challenge is some other
   * purpose, the caller still needs to see it so `verifyCode` can answer `wrong_purpose`.
   * Filtering would report `no_challenge` instead — a different shape on the wire, and a break of
   * the contract the purpose-binding tests pin.
   */
  async findActiveByPhone(
    db: DbOrTx,
    phone: string,
    now: Date,
    preferPurposes: readonly OtpPurpose[] = [],
  ): Promise<OtpChallengeRow | undefined> {
    const active = and(
      eq(phoneOtpChallenges.phone, phone),
      isNull(phoneOtpChallenges.consumedAt),
      gt(phoneOtpChallenges.expiresAt, now),
    );
    // Newest-first is the baseline. The preference clause is only prepended when there is
    // something to prefer: a bare `ORDER BY 0` is read by Postgres as ordinal position zero
    // ("ORDER BY position 0 is not in select list"), not as the constant it looks like.
    const newestFirst = desc(phoneOtpChallenges.createdAt);
    const orderBy =
      preferPurposes.length > 0
        ? [
            sql`case when ${inArray(phoneOtpChallenges.purpose, [...preferPurposes])} then 0 else 1 end`,
            newestFirst,
          ]
        : [newestFirst];
    const [row] = await db
      .select()
      .from(phoneOtpChallenges)
      .where(active)
      .orderBy(...orderBy)
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

  /**
   * Consume the phone's outstanding challenge FOR ONE PURPOSE, so a fresh code can supersede it.
   *
   * The `purpose` argument is the whole point (PRE-LAUNCH GATE 1, docs/runbook/vendor-claim.md).
   * Unscoped, this cancelled every live challenge for the phone, which meant an unauthenticated
   * `/vendor-claim/request` — needing only a vendor account number, printed on shop stickers —
   * silently destroyed whatever login OTP its victim was waiting on. It is required rather than
   * optional so a future caller cannot reintroduce the hole by forgetting it.
   */
  async invalidateActiveForPhone(
    db: DbOrTx,
    phone: string,
    purpose: OtpPurpose,
    now: Date,
  ): Promise<number> {
    const result = await db
      .update(phoneOtpChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(phoneOtpChallenges.phone, phone),
          eq(phoneOtpChallenges.purpose, purpose),
          isNull(phoneOtpChallenges.consumedAt),
        ),
      );
    return result.length ?? 0;
  },
};
