import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { adminRoleGrants } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type AdminRole = (typeof adminRoleGrants.$inferSelect)['role'];
export type AdminRoleGrantRow = typeof adminRoleGrants.$inferSelect;

export type AppendGrant = {
  adminUserId: string;
  role: AdminRole;
  granted: boolean;
  /** Null ONLY for the configuration bootstrap; every admin-made grant names its granter. */
  grantedByAdminUserId: string | null;
  source: 'config' | 'admin';
  reason?: string | null;
  recordedAt?: Date;
};

export const adminRoleGrantsRepo = {
  async append(db: DbOrTx, input: AppendGrant): Promise<AdminRoleGrantRow> {
    const [row] = await db
      .insert(adminRoleGrants)
      .values({
        adminUserId: input.adminUserId,
        role: input.role,
        granted: input.granted,
        grantedByAdminUserId: input.grantedByAdminUserId,
        source: input.source,
        reason: input.reason ?? null,
        ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
      })
      .returning();
    if (!row) throw new Error('adminRoleGrants.append returned no row');
    return row;
  },

  /**
   * Fold the log into the roles this admin holds right now.
   *
   * Ordered by `seq` ASC and nothing else — see the column's comment for why a timestamp cannot
   * be the tie-break. Later rows overwrite earlier ones per role, so a revoke-then-regrant ends
   * granted, and each role is independent of the others.
   *
   * Read on every permissioned admin request, so it is one query and one pass.
   */
  async currentRoles(db: DbOrTx, adminUserId: string): Promise<AdminRole[]> {
    const rows = await db
      .select({ role: adminRoleGrants.role, granted: adminRoleGrants.granted })
      .from(adminRoleGrants)
      .where(eq(adminRoleGrants.adminUserId, adminUserId))
      .orderBy(asc(adminRoleGrants.seq));

    const held = new Map<AdminRole, boolean>();
    for (const row of rows) held.set(row.role, row.granted);
    return [...held.entries()].filter(([, granted]) => granted).map(([role]) => role);
  },

  /** The whole log for one admin, oldest first. The evidence behind `currentRoles`. */
  async listForAdmin(db: DbOrTx, adminUserId: string): Promise<AdminRoleGrantRow[]> {
    return db
      .select()
      .from(adminRoleGrants)
      .where(eq(adminRoleGrants.adminUserId, adminUserId))
      .orderBy(asc(adminRoleGrants.seq));
  },
};
