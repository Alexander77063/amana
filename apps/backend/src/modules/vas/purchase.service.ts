import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { masterWallets } from '../../db/schema';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import type { AnchorBillResponse } from '../../integrations/anchor/types';
import { ConflictError, LimitExceededError } from '../../lib/errors';
import { kobo } from '../../lib/kobo';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { reversalService } from '../transactions/reversal.service';
import { wouldExceedSpendLimit } from '../transactions/spend-limit';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { transactionsRepo } from '../wallet/transactions.repo';
import { assertWalletAccess } from '../wallet/wallet-access.service';
import { beneficiariesService } from './beneficiaries.service';
import { computeCommissionKobo } from './commission';
import {
  REQUIRES_VALIDATION,
  VAS_ANCHOR_TYPE,
  VAS_RECIPIENT_KIND,
  type VasCategory,
} from './config';
import { normalizeRecipient } from './recipient';
import { vasPurchasesRepo } from './vas-purchases.repo';
import { vasSettlementService } from './vas-settlement.service';

type DbOrTx = PostgresJsDatabase;

export type VasCreateInput = {
  actorUserId: string;
  masterWalletId: string;
  subWalletId: string | null;
  category: VasCategory;
  provider: string; // biller slug
  productSlug?: string | null;
  recipient: string;
  amountKobo: bigint;
  idempotencyKey: string;
  now?: Date;
};

export type VasCreateOutput = {
  transactionId: string;
  vasPurchaseId: string;
  status: 'in_flight' | 'settled' | 'failed';
};

export const vasPurchaseService = {
  /**
   * The VAS core. Mirrors `nipOutService.send`: authorize → recipient cash-out gate →
   * (electricity/cable) validate customer → reserve under a per-sub-wallet advisory lock +
   * `wouldExceedSpendLimit` → call `adapter.payBill` → branch on status.
   *   - `COMPLETED` → settle inline via `vasSettlementService.finalise` (commission carve).
   *   - `PENDING` / `INITIATED` → stays `in_flight`; the `bills.successful`/`bills.failed` webhook
   *     settles or refunds later.
   *   - `FAILED` (200-body) or a thrown `AnchorHttpError` → `reversalService.reverse` REFUNDS the
   *     buyer (a failed bill delivered nothing — the deliberate inversion of SP1's redemption rule).
   * Over-limit → `LimitExceededError` (decision #7; NOT converted to a bump — that is deferred).
   */
  async create(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: VasCreateInput,
  ): Promise<VasCreateOutput> {
    const now = input.now ?? new Date();

    // 1. Authorize the actor against the wallet (identity vs ownership, NEVER the role claim).
    await assertWalletAccess(db, input.actorUserId, {
      masterWalletId: input.masterWalletId,
      subWalletId: input.subWalletId,
    });

    // Idempotency short-circuit: return the existing purchase if this key was already used, so a
    // replay re-runs no side effects (no gate re-check, no double debit, no second Anchor call).
    const existing = await transactionsRepo.findByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      const v = await vasPurchasesRepo.findByTransactionId(db, existing.id);
      // Re-authorize the RETURNED resource against the actor — `assertWalletAccess` above only
      // authorized the SUPPLIED wallet, not this pre-existing row. Without this, submitting another
      // buyer's idempotency key would leak their purchase (recipient, amount, prepaid token). A key
      // that maps to someone else's txn is a conflict, not a hit.
      if (v && v.buyerUserId === input.actorUserId) {
        return {
          transactionId: existing.id,
          vasPurchaseId: v.id,
          status: existing.status as VasCreateOutput['status'],
        };
      }
      throw new ConflictError(`idempotency key already used: ${input.idempotencyKey}`);
    }

    const kind = VAS_RECIPIENT_KIND[input.category];
    const recipient = normalizeRecipient(kind, input.recipient);

    // 2. Recipient cash-out control gate (throws ForbiddenError if not permitted).
    let agentUserId: string | null = null;
    if (input.subWalletId) {
      const sub = await subWalletsRepo.findById(db, input.subWalletId);
      if (!sub) throw new Error(`sub_wallet ${input.subWalletId} not found`);
      agentUserId = sub.agentUserId;
    }
    await beneficiariesService.assertRecipientAllowed(db, {
      subWalletId: input.subWalletId,
      agentUserId,
      category: input.category,
      recipient,
    });

    // 3. Validate the customer for electricity/cable BEFORE reserving (throws if invalid).
    let customerName: string | null = null;
    if (REQUIRES_VALIDATION[input.category]) {
      const v = await adapter.validateCustomer(input.provider, recipient);
      customerName = v.customerName;
    }

    // 4. Reserve under the per-sub-wallet advisory lock + limit gate (mirror nip-out).
    const amount = input.amountKobo;
    const { txnId, vasId } = await db
      .transaction(async (txx) => {
        const tx = txx as DbOrTx;
        const masterLA = await ledgerAccountsRepo.findByMasterAndKind(
          tx,
          input.masterWalletId,
          'master',
        );
        const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(
          tx,
          input.masterWalletId,
          'suspense',
        );
        if (!masterLA || !suspenseLA) {
          throw new Error('master wallet missing master/suspense LAs');
        }
        const sourceLA = input.subWalletId
          ? await ledgerAccountsRepo.findBySubWallet(tx, input.subWalletId)
          : masterLA;
        if (!sourceLA) throw new Error('source ledger account missing');

        // Enforce the sub-wallet spend limit authoritatively at reserve. The advisory lock
        // serialises concurrent reserves so two that each pass the pre-check can't both overspend.
        if (input.subWalletId) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.subWalletId}))`);
          if (await wouldExceedSpendLimit(tx, input.subWalletId, kobo(amount), now)) {
            throw new LimitExceededError(`vas purchase exceeds sub-wallet spend limit: ${amount}`);
          }
        }

        const txn = await transactionsRepo.insert(tx, {
          masterWalletId: input.masterWalletId,
          subWalletId: input.subWalletId,
          kind: 'vas_purchase',
          amountKobo: kobo(amount),
          idempotencyKey: input.idempotencyKey,
        });
        // VAS status IS the txn status: a pending bill = an `in_flight` txn. This makes the reserve
        // count in the spend-limit window (Task 5 filters `status IN ('in_flight','settled')`) and
        // makes it settleable/reversible (both require `in_flight`).
        await transactionsRepo.setStatus(tx, txn.id, 'in_flight');
        await ledgerService.writeDoubleEntry(tx, txn.id, [
          { ledgerAccountId: sourceLA.id, debitKobo: kobo(amount), creditKobo: kobo(0n) },
          { ledgerAccountId: suspenseLA.id, debitKobo: kobo(0n), creditKobo: kobo(amount) },
        ]);
        const vas = await vasPurchasesRepo.insert(tx, {
          transactionId: txn.id,
          buyerUserId: input.actorUserId,
          masterWalletId: input.masterWalletId,
          subWalletId: input.subWalletId,
          category: input.category,
          provider: input.provider,
          productSlug: input.productSlug ?? null,
          recipientKind: kind,
          recipient,
          customerName,
          amountKobo: kobo(amount),
          commissionKobo: kobo(computeCommissionKobo(input.category, amount)),
          status: 'pending',
        });
        return { txnId: txn.id, vasId: vas.id };
      })
      .catch((e) => {
        // UNIQUE(idempotency_key) race → a concurrent create won; treat as a conflict.
        if (isUniqueViolation(e)) {
          throw new ConflictError(`vas purchase already exists: ${input.idempotencyKey}`);
        }
        throw e;
      });

    // 5. Look up Amana's Anchor operating account (the DepositAccount that funds the bill).
    const [mw] = await db
      .select()
      .from(masterWallets)
      .where(eq(masterWallets.id, input.masterWalletId))
      .limit(1);
    if (!mw) throw new Error(`master_wallet ${input.masterWalletId} disappeared`);

    // 6. Call Anchor — a synchronous failure reverses (refunds) cleanly.
    let response: AnchorBillResponse;
    try {
      response = await adapter.payBill(
        {
          type: VAS_ANCHOR_TYPE[input.category],
          provider: kind === 'phone' ? input.provider : undefined,
          productSlug: input.productSlug ?? undefined,
          phoneNumber: kind === 'phone' ? recipient : undefined,
          meterAccountNumber: kind !== 'phone' ? recipient : undefined,
          amountKobo: amount,
          reference: input.idempotencyKey,
          accountId: mw.anchorAccountId,
        },
        input.idempotencyKey,
      );
    } catch (e) {
      const reason =
        e instanceof AnchorHttpError
          ? `Anchor HTTP ${e.status}`
          : `Anchor error: ${(e as Error).message}`;
      // Only refund if a webhook hasn't already reached a terminal state (the sync/webhook race).
      if (await stillInFlight(db, txnId)) {
        await reversalService.reverse(db, { transactionId: txnId, reason, failedAt: now });
        await vasPurchasesRepo.setResult(db, vasId, { status: 'failed', completedAt: now });
        await auditRepo.append(
          db,
          auditEvents.vasPurchaseFailed({
            vasPurchaseId: vasId,
            transactionId: txnId,
            reason,
            failedAt: now,
          }),
        );
      }
      return { transactionId: txnId, vasPurchaseId: vasId, status: 'failed' };
    }

    // Record the Anchor bill id + authoritative commission WITHOUT touching status (a webhook may
    // have already driven the row to a terminal status during the payBill round-trip).
    await vasPurchasesRepo.setResult(db, vasId, {
      anchorBillId: response.id,
      commissionKobo: response.commissionKobo,
    });

    // Guard the sync/webhook race: a `bills.*` webhook may have already reached the txn's terminal
    // state between our reserve and this response. Only act on a still-`in_flight` txn; otherwise the
    // webhook already settled/reversed it and the inline branch is a no-op (settle/reverse would
    // otherwise throw `cannot settle/reverse txn in status …` → 500).
    if (!(await stillInFlight(db, txnId))) {
      const cur = await transactionsRepo.findById(db, txnId);
      return {
        transactionId: txnId,
        vasPurchaseId: vasId,
        status: (cur?.status as VasCreateOutput['status']) ?? 'in_flight',
      };
    }

    if (response.status === 'FAILED') {
      await reversalService.reverse(db, {
        transactionId: txnId,
        reason: response.failureReason ?? 'Anchor status=FAILED',
        failedAt: now,
      });
      await vasPurchasesRepo.setResult(db, vasId, { status: 'failed', completedAt: now });
      await auditRepo.append(
        db,
        auditEvents.vasPurchaseFailed({
          vasPurchaseId: vasId,
          transactionId: txnId,
          reason: response.failureReason ?? 'Anchor status=FAILED',
          failedAt: now,
        }),
      );
      return { transactionId: txnId, vasPurchaseId: vasId, status: 'failed' };
    }

    if (response.status === 'COMPLETED') {
      await vasSettlementService.finalise(db, {
        transactionId: txnId,
        commissionKobo: response.commissionKobo,
        token: response.token,
        settledAt: now,
      });
      return { transactionId: txnId, vasPurchaseId: vasId, status: 'settled' };
    }

    // PENDING / INITIATED → wait for the webhook.
    await auditRepo.append(
      db,
      auditEvents.vasPurchaseInitiated({
        vasPurchaseId: vasId,
        transactionId: txnId,
        anchorBillId: response.id,
        category: input.category,
        now,
      }),
    );
    return { transactionId: txnId, vasPurchaseId: vasId, status: 'in_flight' };
  },
};

async function stillInFlight(db: DbOrTx, txnId: string): Promise<boolean> {
  const t = await transactionsRepo.findById(db, txnId);
  return t?.status === 'in_flight';
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
