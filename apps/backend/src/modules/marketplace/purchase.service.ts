import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  ConflictError,
  LimitExceededError,
  NotFoundError,
  RuleDeniedError,
} from '../../lib/errors';
import { type Kobo, kobo } from '../../lib/kobo';
import { evaluate } from '../rules/engine';
import { fetchActiveRuleSet } from '../rules/rule-set.fetcher';
import type { Decision } from '../rules/types';
import { wouldExceedSpendLimit } from '../transactions/spend-limit';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { type TransactionRow, transactionsRepo } from '../wallet/transactions.repo';
import { assertWalletAccess } from '../wallet/wallet-access.service';
import { catalogItemsRepo } from './catalog-items.repo';
import { mintCode, mintQrToken } from './codes';
import { MARKETPLACE_COMMISSION_BPS, VOUCHER_TTL_HOURS } from './config';
import { dealsService } from './deals.service';
import { type RedemptionRow, redemptionsRepo } from './redemptions.repo';
import { retailersRepo } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * Do the parent's rules allow this purchase at all?
 *
 * `reserve` enforces the spend LIMIT and nothing else, so until this existed a category lock did
 * not apply to the marketplace: a sub-wallet locked to transport and school could buy a voucher
 * for anything in the catalogue, while the identical spend as a bank transfer was held for
 * approval. Proved by tools/demo/probe-marketplace.mjs.
 *
 * Also where the control fusion binds: `merchant` rules are evaluated here and nowhere else,
 * because this is the only path with a retailer to match against.
 *
 * Mirrors `assertVasRulesAllow` in modules/vas, including what it deliberately leaves out.
 * `limit` is filtered away because it is already enforced inside `pg_advisory_xact_lock` in
 * `reserve`; evaluating it a second time OUTSIDE that lock would reintroduce the
 * evaluate-then-reserve race the lock exists to close.
 */
async function assertMarketplaceRulesAllow(
  db: DbOrTx,
  input: {
    subWalletId: string;
    category: string | null;
    retailerId: string;
    amountKobo: bigint;
    now: Date;
  },
): Promise<void> {
  const ruleSet = await fetchActiveRuleSet(db, input.subWalletId);
  if (!ruleSet) return;
  const relevant = {
    ...ruleSet,
    rules: ruleSet.rules.filter(
      (r) => r.kind === 'category' || r.kind === 'time_window' || r.kind === 'merchant',
    ),
  };
  if (relevant.rules.length === 0) return;

  const decision: Decision = evaluate(
    {
      amountKobo: kobo(input.amountKobo),
      category: input.category,
      // A marketplace purchase pays a retailer through the voucher, not a vendor account the
      // buyer typed, so there is no bank destination for an allowlist rule to match — and
      // allowlist is filtered out above in any case.
      vendorBankCode: null,
      vendorAccountNumber: null,
      vendorResolvedName: null,
      // The control fusion: this is what a merchant rule matches on, and the only path that
      // supplies it. Everywhere else passes null, so a merchant rule denies there — correctly,
      // since "only these merchants" cannot permit a payment to someone who is not one.
      retailerId: input.retailerId,
      confirmedAt: input.now,
    },
    relevant,
    {
      // Zeroes are safe precisely because `limit` was filtered out: nothing remaining reads the
      // ledger snapshot, and an anomaly score of 0 cannot trip a threshold.
      ledger: {
        subWalletAvailableKobo: kobo(0n),
        spentLast24hKobo: kobo(0n),
        spentLast30dKobo: kobo(0n),
      },
      anomalyScore: 0,
    },
  );

  if (decision.kind !== 'allow') {
    // Reject rather than hold for a bump. `bump_pending` is produced by lifecycle.service, which
    // this path does not go through, and `resumeAfterBump` has no way back into a catalogue
    // purchase — so a "pending" voucher would be one nothing could ever release. Spec §8 wants
    // the bump flow here eventually; that needs marketplace wired into the bump workflow, and is
    // recorded as deferred in the SP5b plan rather than faked.
    throw new RuleDeniedError(
      decision.allReasons.map((r) => r.code),
      'marketplace purchase denied by rules',
    );
  }
}

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
  /** The deal that priced this buy, recorded on the voucher for audit; null = no active deal. */
  dealId?: string | null;
  /** Injectable clock for deterministic expiry in tests; defaults to now. */
  now?: Date;
};

export type CreateFromCatalogInput = {
  /** The buyer initiating the purchase; authorized against the source wallet before any hold. */
  actorUserId: string;
  masterWalletId: string;
  /** null → principal-direct purchase off the master LA (decision #17); set → agent sub-wallet. */
  subWalletId?: string | null;
  catalogItemId: string;
  idempotencyKey: string;
  /** Injectable clock for deterministic pricing + expiry in tests; defaults to now. */
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
   * Reserve discounted funds for a marketplace purchase from **caller-supplied** amounts. Retained
   * for internal callers / tests that already hold the resolved retailer + price; the HTTP path uses
   * `createFromCatalog`, which prices server-side. Delegates to the shared `reserve` seam.
   */
  async create(db: DbOrTx, input: PurchaseInput): Promise<PurchaseResult> {
    return reserve(db, input);
  },

  /**
   * The buyer-facing entry point: resolve the catalog item, its retailer's payout bank, and the
   * **server-side** effective price (`dealsService.effectivePriceKobo`) — the client never supplies
   * a price, closing the discount-spoof vector — then delegate to the same `reserve` seam. Rejects
   * an unknown item (`NotFoundError`), an inactive item or unapproved/missing retailer
   * (`ConflictError`); the shared reserve enforces the sub-wallet spend limit.
   */
  async createFromCatalog(db: DbOrTx, input: CreateFromCatalogInput): Promise<PurchaseResult> {
    const now = input.now ?? new Date();

    const item = await catalogItemsRepo.findById(db, input.catalogItemId);
    if (!item) throw new NotFoundError(`catalog item ${input.catalogItemId} not found`);
    if (item.status !== 'active') {
      throw new ConflictError(`catalog item ${input.catalogItemId} is not active`);
    }

    const retailer = await retailersRepo.findById(db, item.retailerId);
    if (!retailer) throw new ConflictError(`retailer ${item.retailerId} not found`);
    if (retailer.onboardingStatus !== 'approved') {
      throw new ConflictError(
        `retailer ${item.retailerId} is not approved (status=${retailer.onboardingStatus})`,
      );
    }

    // Rules before money. Only an agent buy is rule-gated: a principal-direct purchase spends
    // the master wallet they own (decision #17), and a principal is not bound by rules they set
    // for someone else.
    if (input.subWalletId) {
      await assertMarketplaceRulesAllow(db, {
        subWalletId: input.subWalletId,
        category: item.category,
        retailerId: item.retailerId,
        amountKobo: item.priceKobo as bigint,
        now,
      });
    }

    // Price server-side: gross list price marked down by the best active deal at `now`.
    const { grossKobo, discountedKobo, dealId } = await dealsService.effectivePriceKobo(
      db,
      input.catalogItemId,
      now,
    );

    return reserve(db, {
      actorUserId: input.actorUserId,
      masterWalletId: input.masterWalletId,
      subWalletId: input.subWalletId ?? null,
      retailerId: item.retailerId,
      catalogItemId: input.catalogItemId,
      retailerBankCode: retailer.payoutBankCode,
      retailerAccount: retailer.payoutAccountNumber,
      grossKobo,
      discountedKobo,
      dealId,
      idempotencyKey: input.idempotencyKey,
      now,
    });
  },
};

/**
 * Reserve discounted funds for a marketplace purchase: hold `discountedKobo` in the master
 * wallet's `suspense` LA (debit source, credit suspense) and mint a `reserved` voucher. No Anchor
 * call — funds stay inside the wallet until the retailer redeems (→ external) or the hold expires
 * (→ back to source). Idempotent on `idempotencyKey`: a repeat call returns the existing
 * reservation rather than double-reserving. Shared by `create` and `createFromCatalog`.
 */
async function reserve(db: DbOrTx, input: PurchaseInput): Promise<PurchaseResult> {
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

      // SP5 control-fusion: enforce the sub-wallet spend limit before reserving. An agent
      // marketplace hold consumes the same daily/30-day window as a NIP spend, so take the
      // per-sub-wallet advisory lock (mirroring nip-out.service) to serialise concurrent
      // reserves and close the evaluate→reserve race, then reject over-limit holds outright.
      // A principal-direct purchase (subWalletId null) spends the master LA the principal owns
      // (decision #17) and is not limit-gated.
      if (subWalletId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${subWalletId}))`);
        if (await wouldExceedSpendLimit(tx, subWalletId, input.discountedKobo, now)) {
          throw new LimitExceededError(
            `marketplace purchase exceeds sub-wallet spend limit: ${input.discountedKobo}`,
          );
        }
      }

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
        dealId: input.dealId ?? null,
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
}

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
