import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConflictError } from '../../lib/errors';
import { type Kobo, kobo } from '../../lib/kobo';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { type TransactionRow, transactionsRepo } from '../wallet/transactions.repo';
import { assertWalletAccess } from '../wallet/wallet-access.service';
import { mintCode, mintQrToken } from './codes';
import { MARKETPLACE_COMMISSION_BPS, VOUCHER_TTL_HOURS } from './config';
import { type RedemptionRow, redemptionsRepo } from './redemptions.repo';

type DbOrTx = PostgresJsDatabase;

export type PurchaseInput = {
  /** The buyer initiating the purchase; authorized against the source wallet before any hold. */
  actorUserId: string;
  masterWalletId: string;
  /** null → principal-direct purchase off the master LA (decision #17); set → agent sub-wallet. */
  subWalletId?: string | null;
  retailerId: string;
  catalogItemId: string;
  retailerBankCode: string;
  retailerAccount: string;
  grossKobo: Kobo;
  discountedKobo: Kobo;
  idempotencyKey: string;
  /** Injectable clock for deterministic expiry in tests; defaults to now. */
  now?: Date;
};

export type PurchaseResult = {
  transaction: TransactionRow;
  redemption: RedemptionRow;
};

/** Postgres unique-violation SQLSTATE — a duplicate idempotency key / code / qr token. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

export const purchaseService = {
  /**
   * Reserve discounted funds for a marketplace purchase: hold `discountedKobo` in the master
   * wallet's `suspense` LA (debit source, credit suspense) and mint a `reserved` voucher. No Anchor
   * call — funds stay inside the wallet until the retailer redeems (→ external) or the hold expires
   * (→ back to source). Idempotent on `idempotencyKey`: a repeat call returns the existing
   * reservation rather than double-reserving.
   */
  async create(db: DbOrTx, input: PurchaseInput): Promise<PurchaseResult> {
    const subWalletId = input.subWalletId ?? null;
    const now = input.now ?? new Date();

    // Authorize the actor against the source wallet by identity vs. ownership (never the JWT role):
    // sub-wallet purchase → owning agent only; principal-direct → household principal only.
    await assertWalletAccess(db, input.actorUserId, {
      masterWalletId: input.masterWalletId,
      subWalletId,
    });

    // Guard the money shape: a positive discounted amount no larger than the gross list price.
    if (!(0n < (input.discountedKobo as bigint) && input.discountedKobo <= input.grossKobo)) {
      throw new ConflictError(
        `invalid purchase amounts: discounted=${input.discountedKobo} gross=${input.grossKobo}`,
      );
    }

    // Amana's commission carved *from* the payment (bigint floor), recognised at redeem-settle.
    const commissionKobo = kobo(
      ((input.discountedKobo as bigint) * BigInt(MARKETPLACE_COMMISSION_BPS)) / 10000n,
    );

    // Fast-path idempotency: a repeat with the same key returns the existing reservation without
    // re-entering the write transaction (the sequential case).
    const prior = await transactionsRepo.findByIdempotencyKey(db, input.idempotencyKey);
    if (prior) return loadExistingReservation(db, prior, input);

    try {
      return await db.transaction(async (txx) => {
        const tx = txx as DbOrTx;

        // Resolve ledger accounts (mirrors nip-out): source = sub-wallet LA, or master LA for a
        // principal-direct purchase; sink = suspense.
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
          throw new Error('master_wallet missing master/suspense LAs — should not happen');
        }
        const sourceLA = subWalletId
          ? await ledgerAccountsRepo.findBySubWallet(tx, subWalletId)
          : masterLA;
        if (!sourceLA) throw new Error('source ledger account missing');

        // SP5 control-fusion: rule/limit/bump evaluation wires in here (before reserve).

        const txn = await transactionsRepo.insert(tx, {
          masterWalletId: input.masterWalletId,
          subWalletId,
          kind: 'marketplace_purchase',
          amountKobo: input.discountedKobo,
          idempotencyKey: input.idempotencyKey,
          vendorAccount: input.retailerAccount,
          vendorBankCode: input.retailerBankCode,
        });

        // Reserve legs: debit source, credit suspense — the discounted hold.
        await ledgerService.writeDoubleEntry(tx, txn.id, [
          { ledgerAccountId: sourceLA.id, debitKobo: input.discountedKobo, creditKobo: kobo(0n) },
          { ledgerAccountId: suspenseLA.id, debitKobo: kobo(0n), creditKobo: input.discountedKobo },
        ]);

        // Pre-generate the id so the QR token can be bound to the row (mintQrToken(id)) in one insert.
        const redemptionId = randomUUID();
        const redemption = await redemptionsRepo.insert(tx, {
          id: redemptionId,
          transactionId: txn.id,
          buyerUserId: input.actorUserId,
          masterWalletId: input.masterWalletId,
          subWalletId,
          retailerId: input.retailerId,
          catalogItemId: input.catalogItemId,
          grossKobo: input.grossKobo,
          discountedKobo: input.discountedKobo,
          commissionKobo,
          code: mintCode(),
          qrToken: mintQrToken(redemptionId),
          expiresAt: new Date(now.getTime() + VOUCHER_TTL_HOURS * 3600 * 1000),
          status: 'reserved',
        });

        return { transaction: txn, redemption };
      });
    } catch (e) {
      // Concurrency backstop: a racing caller won the idempotency-key insert while we were mid-tx.
      // After the 23505 the tx is poisoned, so the replay lookup runs on the outer `db`.
      if (isUniqueViolation(e)) {
        const dup = await transactionsRepo.findByIdempotencyKey(db, input.idempotencyKey);
        if (dup) return loadExistingReservation(db, dup, input);
      }
      throw e;
    }
  },
};

/**
 * Return the reservation already booked under this idempotency key, after asserting it belongs to
 * the same source wallet as the current request — so a key reused across actors can't leak another
 * buyer's voucher.
 */
async function loadExistingReservation(
  db: DbOrTx,
  existing: TransactionRow,
  input: PurchaseInput,
): Promise<PurchaseResult> {
  const subWalletId = input.subWalletId ?? null;
  if (existing.masterWalletId !== input.masterWalletId || existing.subWalletId !== subWalletId) {
    throw new ConflictError(`idempotency key reused across wallets: ${input.idempotencyKey}`);
  }
  const redemption = await redemptionsRepo.findByTransactionId(db, existing.id);
  if (!redemption) {
    throw new Error(`reserve txn ${existing.id} has no redemption — inconsistent state`);
  }
  return { transaction: existing, redemption };
}
