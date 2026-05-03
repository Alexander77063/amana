import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const stickerStatusEnum = pgEnum('sticker_status', ['unbound', 'active', 'revoked']);

export const vendorStickers = pgTable('vendor_stickers', {
  uuid: uuid('uuid').primaryKey().default(sql`gen_random_uuid()`),
  bankCode: text('bank_code').notNull(),
  accountNumber: text('account_number').notNull(),
  accountName: text('account_name').notNull(),
  vendorPhone: text('vendor_phone').notNull(),
  status: stickerStatusEnum('status').notNull().default('unbound'),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
});
