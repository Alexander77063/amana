import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import { selectNarration } from '../../integrations/anchor/narration';
import type { AnchorTransferResponse } from '../../integrations/anchor/types';
import { kobo } from '../../lib/kobo';
import { masterWallets } from '../../db/schema';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { transactionsRepo } from '../wallet/transactions.repo';
import { reversalService } from './reversal.service';

type DbOrTx = PostgresJsDatabase;

export type SendInput = {
  transactionId: string;
  /** household ref used in the NIP narration; usually the household id or a short slug. */
  householdRef: string;
  now: Date;
};

export type SendOutput = {
  anchorTransferId: string | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  /** Set when Anchor synchronously rejected the call AND we already reversed locally. */
  reversed?: boolean;
};

export const nipOutService = {
  async send(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: SendInput,
  ): Promise<SendOutput> {
    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn) throw new Error(`transaction not found: ${input.transactionId}`);
    if (txn.status !== 'in_flight') {
      throw new Error(`transaction not in_flight: status=${txn.status}`);
    }
    if (!txn.vendorBankCode || !txn.vendorAccount) {
      throw new Error(`transaction missing vendor bank/account: ${txn.id}`);
    }

    // Resolve ledger accounts:
    //   source = sub-wallet ledger account (or master if principal-direct)
    //   sink   = suspense (per spec §6 step 5)
    const masterLA = await ledgerAccountsRepo.findByMasterAndKind(db, txn.masterWalletId, 'master');
    const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(db, txn.masterWalletId, 'suspense');
    if (!masterLA || !suspenseLA) {
      throw new Error('master_wallet missing master/suspense LAs — should not happen');
    }

    const sourceLA = txn.subWalletId
      ? await ledgerAccountsRepo.findBySubWallet(db, txn.subWalletId)
      : masterLA;
    if (!sourceLA) throw new Error('source ledger account missing');

    // Phase 1: write reservation postings (atomic, balanced).
    const amount = kobo(txn.amountKobo as bigint);
    await ledgerService.writeDoubleEntry(db, txn.id, [
      { ledgerAccountId: sourceLA.id, debitKobo: amount, creditKobo: kobo(0n) },
      { ledgerAccountId: suspenseLA.id, debitKobo: kobo(0n), creditKobo: amount },
    ]);

    // Look up the master wallet's Anchor account ID (opaque) for the from-side of the transfer.
    const [mw] = await db.select().from(masterWallets).where(eq(masterWallets.id, txn.masterWalletId)).limit(1);
    if (!mw) throw new Error(`master_wallet ${txn.masterWalletId} disappeared`);

    // Decision #15: hashed reference is derived from the AGENT's user_id, not the sub-wallet.
    // For principal-direct (subWalletId null), narration uses the simpler `AMN/<household>` form.
    let agentUserId: string | null = null;
    if (txn.subWalletId) {
      const sub = await subWalletsRepo.findById(db, txn.subWalletId);
      if (!sub) throw new Error(`sub_wallet ${txn.subWalletId} not found`);
      agentUserId = sub.agentUserId;
    }
    const narration = selectNarration({
      householdRef: input.householdRef,
      agentUserId,
    });

    // Phase 2: call Anchor — wrap in try/catch so synchronous failures reverse cleanly.
    let response: AnchorTransferResponse;
    try {
      response = await adapter.transfer(
        {
          amountKobo: amount,
          fromAccountId: mw.anchorAccountId,
          toBankCode: txn.vendorBankCode,
          toAccountNumber: txn.vendorAccount,
          narration,
          reference: txn.idempotencyKey,
        },
        txn.idempotencyKey,
      );
    } catch (e) {
      // Synchronous Anchor failure (network, 4xx, exhausted retries on 5xx) → reverse + fail.
      // Per spec §10: "NIP rejected → Reverse suspense, mark FAILED, retry once allowed."
      const reason = e instanceof AnchorHttpError
        ? `Anchor HTTP ${e.status}`
        : `Anchor error: ${(e as Error).message}`;
      await reversalService.reverse(db, {
        transactionId: txn.id,
        reason,
        failedAt: input.now,
      });
      await auditRepo.append(
        db,
        auditEvents.txnNipOutSent({
          transactionId: txn.id,
          actorUserId: agentUserId,
          status: 'FAILED',
          anchorTransferId: null,
          reason,
        }),
      );
      return { anchorTransferId: null, status: 'FAILED', reversed: true };
    }

    if (response.nibssSessionId) {
      await transactionsRepo.setNibssSessionId(db, txn.id, response.nibssSessionId);
    }

    // 200 OK with status='FAILED' is also a synchronous failure — handle the same way.
    if (response.status === 'FAILED') {
      await reversalService.reverse(db, {
        transactionId: txn.id,
        reason: response.failureReason ?? 'Anchor returned status=FAILED',
        failedAt: input.now,
      });
      await auditRepo.append(
        db,
        auditEvents.txnNipOutSent({
          transactionId: txn.id,
          actorUserId: agentUserId,
          status: 'FAILED',
          anchorTransferId: response.id,
          reason: response.failureReason ?? null,
        }),
      );
      return { anchorTransferId: response.id, status: 'FAILED', reversed: true };
    }

    await auditRepo.append(
      db,
      auditEvents.txnNipOutSent({
        transactionId: txn.id,
        actorUserId: agentUserId,
        status: response.status,
        anchorTransferId: response.id,
        reason: null,
      }),
    );

    return { anchorTransferId: response.id, status: response.status };
  },
};
