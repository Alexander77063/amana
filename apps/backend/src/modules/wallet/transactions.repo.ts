import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { type Kobo, kobo } from '../../lib/kobo';

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
  inflowFeeAbsorbedKobo?: Kobo | null;
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
        inflowFeeAbsorbedKobo: input.inflowFeeAbsorbedKobo ?? null,
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

  /** Lifetime sum of the inflow fee Amana absorbed across this wallet's top-ups. */
  async sumInflowFeesAbsorbed(db: DbOrTx, masterWalletId: string): Promise<Kobo> {
    const [row] = await db
      .select({
        total: sql<string>`coalesce(sum(${transactions.inflowFeeAbsorbedKobo}), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.masterWalletId, masterWalletId), eq(transactions.kind, 'topup')));
    return kobo(BigInt(row?.total ?? '0'));
  },

  async setStatus(db: DbOrTx, id: string, status: TxnStatus, settledAt?: Date): Promise<void> {
    const update: Partial<TransactionRow> = { status };
    if (settledAt) update.settledAt = settledAt;
    await db.update(transactions).set(update).where(eq(transactions.id, id));
  },

  /**
   * Atomically claim a transaction for sending by setting `sent_at` only if it
   * is still null. Returns true if this caller won the claim, false if it was
   * already sent — preventing a duplicate NIP-out / double reservation.
   */
  async claimForSend(db: DbOrTx, id: string, now: Date): Promise<boolean> {
    const rows = await db
      .update(transactions)
      .set({ sentAt: now })
      .where(and(eq(transactions.id, id), isNull(transactions.sentAt)))
      .returning({ id: transactions.id });
    return rows.length > 0;
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
