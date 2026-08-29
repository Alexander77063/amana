import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { adminUsers } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type AdminUserRow = typeof adminUsers.$inferSelect;

export type InsertAdminUser = {
  email: string;
  provisioningSource: 'config' | 'admin';
  displayName?: string | null;
};

export const adminUsersRepo = {
  /**
   * Insert unless this email already has an admin. Returns null when one existed.
   *
   * `onConflictDoNothing` rather than a read-then-write: the bootstrap seed runs on every boot of
   * every web instance, so two instances starting together would otherwise race into a duplicate
   * and one would crash the boot on the unique index.
   */
  async insertIfAbsent(db: DbOrTx, input: InsertAdminUser): Promise<AdminUserRow | null> {
    const [row] = await db
      .insert(adminUsers)
      .values({
        email: input.email,
        provisioningSource: input.provisioningSource,
        displayName: input.displayName ?? null,
      })
      .onConflictDoNothing({ target: adminUsers.email })
      .returning();
    return row ?? null;
  },

  async findByEmail(db: DbOrTx, email: string): Promise<AdminUserRow | null> {
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    return row ?? null;
  },

  async findById(db: DbOrTx, id: string): Promise<AdminUserRow | null> {
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return row ?? null;
  },

  /**
   * Stamp a successful sign-in: bind the Google subject the first time, refresh the display name,
   * and record when. The caller has already established that any bound subject matches, so this
   * writes rather than decides.
   */
  async recordSignIn(
    db: DbOrTx,
    id: string,
    input: { googleSubject: string; displayName: string | null; now: Date },
  ): Promise<AdminUserRow> {
    const [row] = await db
      .update(adminUsers)
      .set({
        googleSubject: input.googleSubject,
        displayName: input.displayName,
        lastSignedInAt: input.now,
      })
      .where(eq(adminUsers.id, id))
      .returning();
    if (!row) throw new Error('adminUsers.recordSignIn matched no row');
    return row;
  },

  async setStatus(
    db: DbOrTx,
    id: string,
    status: 'active' | 'suspended',
  ): Promise<AdminUserRow | null> {
    const [row] = await db
      .update(adminUsers)
      .set({ status })
      .where(eq(adminUsers.id, id))
      .returning();
    return row ?? null;
  },

  async listAll(db: DbOrTx): Promise<AdminUserRow[]> {
    return db.select().from(adminUsers);
  },
};
