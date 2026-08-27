import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorConsents } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type VendorConsentRow = typeof vendorConsents.$inferSelect;
export type VendorConsentPurpose = VendorConsentRow['purpose'];

export const vendorConsentsRepo = {
  /**
   * Append one consent event. There is deliberately no update and no delete.
   *
   * A revocation is a `granted: false` row, not a mutation of the grant. The question that actually
   * gets asked — by a regulator, or in a dispute — is "what had this merchant agreed to **at the
   * time you processed their data**", and only a log can answer it. Overwriting would destroy the
   * evidence at exactly the moment it becomes interesting.
   */
  async append(
    db: DbOrTx,
    input: {
      vendorId: string;
      purpose: VendorConsentPurpose;
      granted: boolean;
      termsVersion: string | null;
      source: string;
      now: Date;
    },
  ): Promise<VendorConsentRow> {
    const [row] = await db
      .insert(vendorConsents)
      .values({
        vendorId: input.vendorId,
        purpose: input.purpose,
        granted: input.granted,
        termsVersion: input.termsVersion,
        source: input.source,
        recordedAt: input.now,
      })
      .returning();
    if (!row) throw new Error('vendorConsents.append returned no row');
    return row;
  },

  /** The most recent event for one purpose — the current answer, folded from the log. */
  async latest(
    db: DbOrTx,
    vendorId: string,
    purpose: VendorConsentPurpose,
  ): Promise<VendorConsentRow | undefined> {
    const [row] = await db
      .select()
      .from(vendorConsents)
      .where(and(eq(vendorConsents.vendorId, vendorId), eq(vendorConsents.purpose, purpose)))
      .orderBy(desc(vendorConsents.seq))
      .limit(1);
    return row;
  },

  /** The whole log for one vendor, newest first. The evidence, unfolded. */
  async history(db: DbOrTx, vendorId: string): Promise<VendorConsentRow[]> {
    return db
      .select()
      .from(vendorConsents)
      .where(eq(vendorConsents.vendorId, vendorId))
      .orderBy(desc(vendorConsents.seq));
  },
};
