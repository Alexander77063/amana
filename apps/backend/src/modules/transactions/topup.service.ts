import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { masterWallets } from '../../db/schema';
import { type Kobo, kobo } from '../../lib/kobo';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export type HandleTopupInput = {
  /** Anchor's opaque internal account ID (matches `master_wallets.anchor_account_id`). */
  virtualAccountId: string;
  amountKobo: Kobo;
  nibssSessionId: string;
  senderBankCode: string;
  senderAccountNumber: string;
  senderAccountName: string;
  receivedAt: Date;
};

export type HandleTopupResult =
  | { kind: 'created'; transactionId: string }
  | { kind: 'duplicate'; transactionId: string }
  | { kind: 'unknown_account' };

export const topupService = {
  async handle(db: DbOrTx, input: HandleTopupInput): Promise<HandleTopupResult> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const [mw] = await txDb
        .select()
        .from(masterWallets)
        .where(eq(masterWallets.anchorAccountId, input.virtualAccountId))
        .limit(1);
      if (!mw) return { kind: 'unknown_account' as const };

      const idempotencyKey = `topup:${input.nibssSessionId}`;

      // Idempotency: if we've already booked this NIP session ID as a topup, short-circuit.
      const existing = await transactionsRepo.findByIdempotencyKey(txDb, idempotencyKey);
      if (existing) {
        return { kind: 'duplicate' as const, transactionId: existing.id };
      }

      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, mw.id, 'master');
      let externalLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, mw.id, 'external');
      if (!masterLA) throw new Error('master LA missing');
      if (!externalLA) {
        externalLA = await ledgerAccountsRepo.insert(txDb, {
          masterWalletId: mw.id,
          kind: 'external',
          normalSide: 'credit',
        });
      }

      const txn = await transactionsRepo.insert(txDb, {
        masterWalletId: mw.id,
        kind: 'topup',
        amountKobo: input.amountKobo,
        idempotencyKey,
      });
      await transactionsRepo.setNibssSessionId(txDb, txn.id, input.nibssSessionId);

      // Topup posting: debit master (we now hold more), credit external (money came from outside).
      await ledgerService.writeDoubleEntry(txDb, txn.id, [
        { ledgerAccountId: masterLA.id, debitKobo: input.amountKobo, creditKobo: kobo(0n) },
        { ledgerAccountId: externalLA.id, debitKobo: kobo(0n), creditKobo: input.amountKobo },
      ]);

      await transactionsRepo.setStatus(txDb, txn.id, 'settled', input.receivedAt);

      await auditRepo.append(
        txDb,
        auditEvents.txnToppedUp({
          transactionId: txn.id,
          masterWalletId: mw.id,
          amountKobo: input.amountKobo as bigint,
          nibssSessionId: input.nibssSessionId,
          senderBankCode: input.senderBankCode,
          senderAccountNumber: input.senderAccountNumber,
          senderAccountName: input.senderAccountName,
          receivedAt: input.receivedAt,
        }),
      );

      return { kind: 'created' as const, transactionId: txn.id };
    });
  },
};
