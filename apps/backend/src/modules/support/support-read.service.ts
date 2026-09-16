import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  households,
  masterWallets,
  ruleSets,
  rules,
  subWallets,
  transactions,
} from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

/**
 * What support is allowed to see, and — more to the point — what it is not.
 *
 * Every shape here is built FIELD BY FIELD. Nothing spreads a row. Spreading is how BVN reaches a
 * response: `{...user}` silently picks up every column the table gains later, including ones added
 * long after this code was reviewed. If a field is not written out below, it cannot leak.
 */

export type SupportOverview = {
  maskedAccount: string | null;
  masterBalanceKobo: string | null;
  subWallets: Array<{ id: string; name: string; status: string }>;
};

export type SupportTransaction = {
  id: string;
  amountKobo: string;
  kind: string;
  status: string;
  occurredAt: string;
  vendorName: string | null;
  category: string | null;
  /** Populated when the spend failed. This is the "why was I declined" answer. */
  failureReason: string | null;
};

export type SupportRule = {
  id: string;
  kind: string;
  priority: number;
  /** A human sentence. NEVER the raw config — see `summarise`. */
  summary: string;
};

/** Last four digits only. Masking lives here, in one place, so there is one thing to audit. */
function maskAccount(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

/**
 * A rule's config is NOT safe to echo. An `allowlist` holds vendor bank accounts
 * (`{ bankCode, accountNumber }[]`), and a support operator has no business reading account
 * numbers — that is the very thing this feature withholds. So each kind gets a sentence that says
 * what the rule DOES, with counts where the detail is sensitive.
 */
function summarise(kind: string, config: unknown): string {
  const c = (config ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'limit': {
      const per = typeof c.perTransactionKobo === 'string' ? c.perTransactionKobo : null;
      const daily = typeof c.dailyKobo === 'string' ? c.dailyKobo : null;
      const parts = [
        per ? `${per} kobo per transaction` : null,
        daily ? `${daily} kobo per day` : null,
      ].filter(Boolean);
      return parts.length > 0 ? `Limit: ${parts.join(', ')}` : 'Limit';
    }
    case 'category': {
      const allowed = Array.isArray(c.allowed) ? c.allowed.length : 0;
      const blocked = Array.isArray(c.blocked) ? c.blocked.length : 0;
      return `Category lock: ${allowed} allowed, ${blocked} blocked`;
    }
    case 'time_window':
      return 'Time window';
    case 'allowlist': {
      // Counts only. The accounts themselves are exactly what must not appear here.
      const accounts = Array.isArray(c.accounts) ? c.accounts.length : 0;
      const names = Array.isArray(c.nameSubstrings) ? c.nameSubstrings.length : 0;
      return `Allowlist: ${accounts} account(s), ${names} name pattern(s)`;
    }
    case 'anomaly_threshold':
      return 'Anomaly threshold';
    case 'merchant':
      return 'Merchant rule';
    default:
      return kind;
  }
}

/** The sub-wallets in scope: the whole household for a principal, their own for an agent. */
async function subWalletsFor(
  db: DbOrTx,
  userId: string,
): Promise<{
  masterWalletId: string | null;
  subs: Array<{ id: string; name: string; status: string }>;
}> {
  const [owned] = await db
    .select({ id: masterWallets.id })
    .from(masterWallets)
    .innerJoin(households, eq(households.id, masterWallets.householdId))
    .where(eq(households.principalUserId, userId))
    .limit(1);

  if (owned) {
    const subs = await db
      .select({ id: subWallets.id, name: subWallets.name, status: subWallets.status })
      .from(subWallets)
      .where(eq(subWallets.masterWalletId, owned.id));
    return { masterWalletId: owned.id, subs };
  }

  const agentSubs = await db
    .select({
      id: subWallets.id,
      name: subWallets.name,
      status: subWallets.status,
      masterWalletId: subWallets.masterWalletId,
    })
    .from(subWallets)
    .where(eq(subWallets.agentUserId, userId));

  return {
    masterWalletId: agentSubs[0]?.masterWalletId ?? null,
    subs: agentSubs.map((s) => ({ id: s.id, name: s.name, status: s.status })),
  };
}

export const supportReadService = {
  async overview(db: DbOrTx, userId: string): Promise<SupportOverview> {
    const { masterWalletId, subs } = await subWalletsFor(db, userId);
    if (!masterWalletId) return { maskedAccount: null, masterBalanceKobo: null, subWallets: subs };

    const [wallet] = await db
      .select({ account: masterWallets.anchorVirtualAccount })
      .from(masterWallets)
      .where(eq(masterWallets.id, masterWalletId))
      .limit(1);

    return {
      maskedAccount: wallet ? maskAccount(wallet.account) : null,
      // Balance is deliberately omitted rather than approximated: the ledger is the source of
      // truth and a wrong number on a support screen is worse than no number.
      masterBalanceKobo: null,
      subWallets: subs,
    };
  },

  async transactions(db: DbOrTx, userId: string, limit = 50): Promise<SupportTransaction[]> {
    const { masterWalletId, subs } = await subWalletsFor(db, userId);
    if (!masterWalletId) return [];

    // A principal sees the household's spend; an agent sees only their own sub-wallet's.
    const subIds = subs.map((s) => s.id);
    const scope = await db
      .select({
        id: transactions.id,
        amountKobo: transactions.amountKobo,
        kind: transactions.kind,
        status: transactions.status,
        createdAt: transactions.createdAt,
        vendorResolvedName: transactions.vendorResolvedName,
        resolvedCategory: transactions.resolvedCategory,
        errorMessage: transactions.errorMessage,
      })
      .from(transactions)
      .where(
        subIds.length > 0
          ? and(
              eq(transactions.masterWalletId, masterWalletId),
              inArray(transactions.subWalletId, subIds),
            )
          : eq(transactions.masterWalletId, masterWalletId),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(limit);

    return scope.map((t) => ({
      id: t.id,
      amountKobo: t.amountKobo.toString(),
      kind: t.kind,
      status: t.status,
      occurredAt: t.createdAt.toISOString(),
      vendorName: t.vendorResolvedName,
      category: t.resolvedCategory,
      failureReason: t.errorMessage,
    }));
  },

  async rules(db: DbOrTx, userId: string): Promise<SupportRule[]> {
    const { subs } = await subWalletsFor(db, userId);
    if (subs.length === 0) return [];

    const rows = await db
      .select({
        id: rules.id,
        kind: rules.kind,
        priority: rules.priority,
        configJson: rules.configJson,
      })
      .from(rules)
      .innerJoin(ruleSets, eq(ruleSets.id, rules.ruleSetId))
      .where(
        and(
          inArray(
            ruleSets.subWalletId,
            subs.map((s) => s.id),
          ),
          eq(ruleSets.status, 'active'),
        ),
      )
      .orderBy(rules.priority);

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      priority: r.priority,
      summary: summarise(r.kind, r.configJson),
    }));
  },
};
