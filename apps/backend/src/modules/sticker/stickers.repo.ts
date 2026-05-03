import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorStickers } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type StickerStatus = 'unbound' | 'active' | 'revoked';

export type NewSticker = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  vendorPhone: string;
  status?: StickerStatus;
};

export type StickerRow = typeof vendorStickers.$inferSelect;

export const stickersRepo = {
  async insert(db: DbOrTx, input: NewSticker): Promise<StickerRow> {
    const [row] = await db
      .insert(vendorStickers)
      .values({
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
        vendorPhone: input.vendorPhone,
        status: input.status ?? 'unbound',
      })
      .returning();
    if (!row) throw new Error('stickers.insert returned no row');
    return row;
  },

  async findByUuid(db: DbOrTx, uuid: string): Promise<StickerRow | undefined> {
    const [row] = await db.select().from(vendorStickers).where(eq(vendorStickers.uuid, uuid)).limit(1);
    return row;
  },

  async setStatus(db: DbOrTx, uuid: string, status: StickerStatus): Promise<void> {
    await db.update(vendorStickers).set({ status }).where(eq(vendorStickers.uuid, uuid));
  },
};
