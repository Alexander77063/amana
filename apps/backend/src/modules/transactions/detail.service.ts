import type { TransactionDetail } from '@amana/types';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { maskAccount } from '../../lib/mask-account';

type Row = {
  id: string;
  kind: TransactionDetail['kind'];
  status: TransactionDetail['status'];
  amount_kobo: string; // pg-js bigint → string
  vendor_resolved_name: string | null;
  vendor_account: string | null;
  vendor_bank_code: string | null;
  category: string | null;
  sub_wallet_id: string | null;
  sub_wallet_name: string | null;
  agent_user_id: string | null;
  principal_user_id: string;
  principal_phone: string;
  initiated_at: Date;
  settled_at: Date | null;
  nibss_session_id: string | null;
  error_message: string | null;
  agent_note: string | null;
  anomaly_score: string | null; // decimal → string
  lat: number | null;
  lng: number | null;
};

const DETAIL_SELECT = sql`
  SELECT
    t.id,
    t.kind::text AS kind,
    t.status::text AS status,
    t.amount_kobo::text AS amount_kobo,
    t.vendor_resolved_name,
    t.vendor_account,
    t.vendor_bank_code,
    t.category,
    t.sub_wallet_id,
    sw.name AS sub_wallet_name,
    sw.agent_user_id,
    h.principal_user_id,
    pu.phone AS principal_phone,
    t.created_at AS initiated_at,
    t.settled_at,
    t.nibss_session_id,
    t.error_message,
    t.agent_note,
    t.anomaly_score::text AS anomaly_score,
    ST_Y(t.geolocation::geometry) AS lat,
    ST_X(t.geolocation::geometry) AS lng
  FROM transactions t
  INNER JOIN master_wallets mw ON mw.id = t.master_wallet_id
  INNER JOIN households h ON h.id = mw.household_id
  INNER JOIN users pu ON pu.id = h.principal_user_id
  LEFT JOIN sub_wallets sw ON sw.id = t.sub_wallet_id
`;

function buildDetail(row: Row): TransactionDetail {
  const isAgentInitiated = row.sub_wallet_id !== null && row.agent_user_id !== null;
  const initiatedBy: TransactionDetail['initiatedBy'] = isAgentInitiated
    ? {
        userId: row.agent_user_id as string,
        // Proxy displayName: sub-wallet name (the principal-chosen label for this agent).
        displayName: row.sub_wallet_name as string,
        role: 'agent',
      }
    : {
        userId: row.principal_user_id,
        // Proxy displayName: principal's phone. Mobile overrides to "You" client-side.
        displayName: row.principal_phone,
        role: 'principal',
      };

  const initiatedAt =
    row.initiated_at instanceof Date
      ? row.initiated_at.toISOString()
      : new Date(row.initiated_at).toISOString();
  const settledAt = row.settled_at
    ? row.settled_at instanceof Date
      ? row.settled_at.toISOString()
      : new Date(row.settled_at).toISOString()
    : null;

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amountKobo: row.amount_kobo,
    vendorResolvedName: row.vendor_resolved_name,
    vendorAccountMasked: maskAccount(row.vendor_account),
    vendorBankCode: row.vendor_bank_code,
    category: row.category,
    subWallet:
      row.sub_wallet_id && row.sub_wallet_name
        ? { id: row.sub_wallet_id, name: row.sub_wallet_name }
        : null,
    initiatedBy,
    initiatedAt,
    settledAt,
    nibssSessionId: row.nibss_session_id,
    errorMessage: row.error_message,
    agentNote: row.agent_note,
    anomalyScore: row.anomaly_score === null ? null : Number(row.anomaly_score),
    geolocation:
      row.lat !== null && row.lng !== null ? { lat: Number(row.lat), lng: Number(row.lng) } : null,
  };
}

export const transactionDetailService = {
  /**
   * Returns the enriched detail or null if either:
   *   (a) the txn does not exist, or
   *   (b) it exists but belongs to a household whose principal is NOT principalUserId.
   * Caller should map both to 404 with the same code (no existence leak).
   *
   * Initiator is reconstructed from the FK graph (no `initiated_by_user_id` column at v1):
   *   - sub_wallet_id IS NOT NULL → initiator = sub_wallets.agent_user_id (role='agent')
   *   - sub_wallet_id IS NULL     → initiator = households.principal_user_id (role='principal')
   *
   * For agent role, displayName is the sub-wallet name (proxy: principal-chosen label).
   * For principal role, displayName is the principal's phone (mobile renders "You" client-side).
   */
  async getByIdForPrincipal(
    db: PostgresJsDatabase,
    transactionId: string,
    principalUserId: string,
  ): Promise<TransactionDetail | null> {
    const rows = await db.execute<Row>(sql`
      ${DETAIL_SELECT}
      WHERE t.id = ${transactionId}
        AND h.principal_user_id = ${principalUserId}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) return null;
    return buildDetail(row);
  },

  /**
   * Returns the enriched detail or null if either:
   *   (a) the txn does not exist, or
   *   (b) it exists but the sub-wallet does not belong to agentUserId.
   * Caller should map both to 404 with the same code (no existence leak).
   */
  async getByIdForAgent(
    db: PostgresJsDatabase,
    transactionId: string,
    agentUserId: string,
  ): Promise<TransactionDetail | null> {
    const rows = await db.execute<Row>(sql`
      ${DETAIL_SELECT}
      WHERE t.id             = ${transactionId}
        AND sw.agent_user_id = ${agentUserId}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) return null;
    return buildDetail(row);
  },
};
