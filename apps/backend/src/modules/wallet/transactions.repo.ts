import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type TxnKind = 'spend' | 'topup' | 'refund' | 'fee' | 'reversal';
export type TxnStatus =
  | 'draft'
  | 'rule_eval'
  | 'bump_pending'
  | 'in_flight'
  | 'settled'
  | 'failed'
  | 'reversed';

export type TransactionRow = typeof transactions.$inferSelect;

export type NewTransaction = {
  masterWalletId: string;
  subWalletId?: string | null;
  kind: TxnKind;
  amountKobo: Kobo;
  idempotencyKey: string;
  vendorAccount?: string | null;
  vendorBankCode?: string | null;
  vendorResolvedName?: string | null;
  category?: string | null;
  agentNote?: string | null;
};

export const transactionsRepo = {
  async insert(db: DbOrTx, input: NewTransaction): Promise<TransactionRow> {
    const [row] = await db
      .insert(transactions)
      .values({
        masterWalletId: input.masterWalletId,
        subWalletId: input.subWalletId ?? null,
        kind: input.kind,
        amountKobo: input.amountKobo,
        idempotencyKey: input.idempotencyKey,
        vendorAccount: input.vendorAccount ?? null,
        vendorBankCode: input.vendorBankCode ?? null,
        vendorResolvedName: input.vendorResolvedName ?? null,
        category: input.category ?? null,
        agentNote: input.agentNote ?? null,
      })
      .returning();
    if (!row) throw new Error('transactions.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<TransactionRow | undefined> {
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    return row;
  },

  async findByIdempotencyKey(db: DbOrTx, key: string): Promise<TransactionRow | undefined> {
    const [row] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.idempotencyKey, key))
      .limit(1);
    return row;
  },

  async setStatus(db: DbOrTx, id: string, status: TxnStatus, settledAt?: Date): Promise<void> {
    const update: Partial<TransactionRow> = { status };
    if (settledAt) update.settledAt = settledAt;
    await db.update(transactions).set(update).where(eq(transactions.id, id));
  },

  async setNibssSessionId(db: DbOrTx, id: string, sessionId: string): Promise<void> {
    await db.update(transactions).set({ nibssSessionId: sessionId }).where(eq(transactions.id, id));
  },

  async setErrorMessage(db: DbOrTx, id: string, errorMessage: string): Promise<void> {
    await db.update(transactions).set({ errorMessage }).where(eq(transactions.id, id));
  },

  async attachMedia(db: DbOrTx, id: string, mediaKey: string, now: Date): Promise<void> {
    await db
      .update(transactions)
      .set({ attachedMedia: { key: mediaKey, uploadedAt: now.toISOString() } })
      .where(eq(transactions.id, id));
  },

  async setAnomalyScore(db: DbOrTx, id: string, score: number): Promise<void> {
    await db
      .update(transactions)
      .set({ anomalyScore: score.toFixed(2) })
      .where(eq(transactions.id, id));
  },
};
