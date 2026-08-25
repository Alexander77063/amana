import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorObservations } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ObservationRow = typeof vendorObservations.$inferSelect;

export type RecordInput = {
  bankCode: string;
  accountNumber: string;
  householdId: string;
  accountName: string;
  category: string | null;
  now: Date;
};

export type ThresholdRow = {
  bankCode: string;
  accountNumber: string;
  householdCount: number;
  accountName: string;
};

export const vendorObservationsRepo = {
  /**
   * Insert-or-increment one household's observation of one account.
   *
   * Raw SQL rather than Drizzle's `onConflictDoUpdate` because the category tally is a jsonb
   * read-modify-write that has to happen inside the UPDATE — doing it in application code would
   * make two concurrent settlements to the same vendor lose one of their increments.
   */
  async record(db: DbOrTx, input: RecordInput): Promise<void> {
    const { bankCode, accountNumber, householdId, accountName, category, now } = input;
    const nowStr = now.toISOString();

    const initialCounts =
      category === null ? sql`'{}'::jsonb` : sql`jsonb_build_object(${category}::text, 1)`;
    const mergedCounts =
      category === null
        ? sql`vendor_observations.category_counts`
        : sql`vendor_observations.category_counts || jsonb_build_object(
              ${category}::text,
              COALESCE((vendor_observations.category_counts ->> ${category}::text)::int, 0) + 1
            )`;

    await db.execute(sql`
      INSERT INTO vendor_observations
        (bank_code, account_number, household_id, account_name,
         settled_count, category_counts, first_seen_at, last_seen_at)
      VALUES
        (${bankCode}, ${accountNumber}, ${householdId}, ${accountName},
         1, ${initialCounts}, ${nowStr}::timestamp with time zone, ${nowStr}::timestamp with time zone)
      ON CONFLICT (bank_code, account_number, household_id) DO UPDATE SET
        settled_count   = vendor_observations.settled_count + 1,
        account_name    = EXCLUDED.account_name,
        last_seen_at    = EXCLUDED.last_seen_at,
        category_counts = ${mergedCounts}
    `);
  },

  async listForAccount(
    db: DbOrTx,
    bankCode: string,
    accountNumber: string,
  ): Promise<ObservationRow[]> {
    return db
      .select()
      .from(vendorObservations)
      .where(
        and(
          eq(vendorObservations.bankCode, bankCode),
          eq(vendorObservations.accountNumber, accountNumber),
        ),
      );
  },

  /**
   * Accounts paid by at least `minHouseholds` DISTINCT households.
   *
   * COUNT(*) is the distinct-household count with no DISTINCT keyword because household_id is in
   * the primary key — one row per household, always. `accountName` is the most recently seen name
   * across those households, which is the best NIBSS answer available at promotion time.
   */
  async accountsAtOrAboveThreshold(db: DbOrTx, minHouseholds: number): Promise<ThresholdRow[]> {
    const rows = await db.execute<{
      bank_code: string;
      account_number: string;
      household_count: number;
      account_name: string;
    }>(sql`
      SELECT bank_code,
             account_number,
             COUNT(*)::int AS household_count,
             (array_agg(account_name ORDER BY last_seen_at DESC))[1] AS account_name
      FROM vendor_observations
      GROUP BY bank_code, account_number
      HAVING COUNT(*) >= ${minHouseholds}
    `);
    return rows.map((r) => ({
      bankCode: r.bank_code,
      accountNumber: r.account_number,
      householdCount: r.household_count,
      accountName: r.account_name,
    }));
  },

  /**
   * Forget accounts that never looked like merchants: no activity since `before`, and no vendors
   * row. An account we have already promoted keeps its observations, because those are what the
   * consensus pass re-reads on every sweep.
   */
  async pruneStaleUnpromoted(db: DbOrTx, before: Date): Promise<number> {
    const beforeStr = before.toISOString();
    const rows = await db.execute<{ ok: number }>(sql`
      DELETE FROM vendor_observations o
      WHERE o.last_seen_at < ${beforeStr}::timestamp with time zone
        AND NOT EXISTS (
          SELECT 1 FROM vendors v
          WHERE v.bank_code = o.bank_code AND v.account_number = o.account_number
        )
      RETURNING 1 AS ok
    `);
    return rows.length;
  },
};
