import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { transactions } from './transactions';
import { ledgerAccounts } from './wallet';

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    ledgerAccountId: uuid('ledger_account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    debitKobo: bigint('debit_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
    creditKobo: bigint('credit_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nonNegativeDebit: check('postings_debit_nonneg', sql`${t.debitKobo} >= 0`),
    nonNegativeCredit: check('postings_credit_nonneg', sql`${t.creditKobo} >= 0`),
    exclusiveSide: check(
      'postings_exclusive_side',
      sql`(${t.debitKobo} > 0) <> (${t.creditKobo} > 0)`,
    ),
  }),
);
