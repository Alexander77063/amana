import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorRecents } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type RecentRow = typeof vendorRecents.$inferSelect;

export type UpsertInput = {
  subWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  now: Date;
};

export const recentsRepo = {
  /** Insert if new; promote (set last_used_at) if already exists. Atomic via INSERT ... ON CONFLICT. */
  async upsert(db: DbOrTx, input: UpsertInput): Promise<RecentRow> {
    const [row] = await db
      .insert(vendorRecents)
      .values({
        subWalletId: input.subWalletId,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
        lastUsedAt: input.now,
        firstSeenAt: input.now,
      })
      .onConflictDoUpdate({
        target: [vendorRecents.subWalletId, vendorRecents.bankCode, vendorRecents.accountNumber],
        set: { lastUsedAt: input.now, accountName: input.accountName },
      })
      .returning();
    if (!row) throw new Error('recents.upsert returned no row');
    return row;
  },

  async listTop(db: DbOrTx, subWalletId: string, limit: number): Promise<RecentRow[]> {
    return db
      .select()
      .from(vendorRecents)
      .where(eq(vendorRecents.subWalletId, subWalletId))
      .orderBy(desc(vendorRecents.lastUsedAt))
      .limit(limit);
  },

  async findByVendor(
    db: DbOrTx,
    subWalletId: string,
    bankCode: string,
    accountNumber: string,
  ): Promise<RecentRow | undefined> {
    const [row] = await db
      .select()
      .from(vendorRecents)
      .where(
        and(
          eq(vendorRecents.subWalletId, subWalletId),
          eq(vendorRecents.bankCode, bankCode),
          eq(vendorRecents.accountNumber, accountNumber),
        ),
      )
      .limit(1);
    return row;
  },

  /** Trim to the top N most-recent entries; delete the older ones. Used by recents.service to bound the table. */
  async trimToLimit(db: DbOrTx, subWalletId: string, keep: number): Promise<number> {
    const result = await db.execute<{ deleted: string }>(sql`
      WITH ranked AS (
        SELECT sub_wallet_id, bank_code, account_number,
               ROW_NUMBER() OVER (PARTITION BY sub_wallet_id ORDER BY last_used_at DESC) AS rn
        FROM vendor_recents
        WHERE sub_wallet_id = ${subWalletId}
      )
      DELETE FROM vendor_recents v
      USING ranked r
      WHERE v.sub_wallet_id = r.sub_wallet_id
        AND v.bank_code = r.bank_code
        AND v.account_number = r.account_number
        AND r.rn > ${keep}
      RETURNING 1
    `);
    return result.length;
  },
};
