import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { userConsents } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type UserConsentRow = typeof userConsents.$inferSelect;

/**
 * One version per role, because principals and agents accept **different documents**.
 *
 * Code constants rather than env vars, for the same reason as the vendor one: a version is a fact
 * about the text that shipped, not a deployment setting. If it were configurable, two environments
 * could record "v1" meaning two different documents — precisely the ambiguity a version exists to
 * remove.
 *
 * The text lives at `docs/legal/{principal,agent}-terms/<version>.md`, and
 * `tests/modules/identity/user-terms-text.test.ts` fails if either document is missing. **Bump a
 * version whenever its text changes**, and understand what that means: everyone who accepted the
 * old one has NOT accepted the new one.
 */
export const PRINCIPAL_TERMS_VERSION = '2026-08-27.v1';
export const AGENT_TERMS_VERSION = '2026-08-27.v1';

/** The document a given role must accept. Retailers accept the portal's own terms, not these. */
export function requiredTermsVersion(role: 'principal' | 'agent'): string {
  return role === 'principal' ? PRINCIPAL_TERMS_VERSION : AGENT_TERMS_VERSION;
}

export const userConsentService = {
  /** Whether the submitted version matches the document this role would have been shown. */
  isCurrentTermsVersion(role: 'principal' | 'agent', version: string | undefined | null): boolean {
    return version === requiredTermsVersion(role);
  },

  /**
   * Record acceptance at sign-up, inside the caller's transaction.
   *
   * `grantedByUserId` is threaded through but nothing supplies it yet — see the column comment.
   * It is here rather than added later so the guardian case, when it is decided, is a wiring
   * change and not a migration against live consent data.
   */
  async recordAcceptance(
    db: DbOrTx,
    input: {
      userId: string;
      termsVersion: string;
      source: string;
      grantedByUserId?: string | null;
      now: Date;
    },
  ): Promise<void> {
    await db.insert(userConsents).values({
      userId: input.userId,
      purpose: 'service_terms',
      granted: true,
      termsVersion: input.termsVersion,
      grantedByUserId: input.grantedByUserId ?? null,
      source: input.source,
      recordedAt: input.now,
    });
  },

  /** The latest event for a user. Absent means never asked, which is not the same as refused. */
  async latest(db: DbOrTx, userId: string): Promise<UserConsentRow | undefined> {
    const [row] = await db
      .select()
      .from(userConsents)
      .where(and(eq(userConsents.userId, userId), eq(userConsents.purpose, 'service_terms')))
      .orderBy(desc(userConsents.seq))
      .limit(1);
    return row;
  },

  /** The full log for a subject access request or a dispute. Newest first. */
  async history(db: DbOrTx, userId: string): Promise<UserConsentRow[]> {
    return db
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, userId))
      .orderBy(desc(userConsents.seq));
  },

  /**
   * Whether this user has accepted the version currently in force for their role.
   *
   * False when they accepted an older version — which is the honest answer, and the hook a
   * re-acceptance prompt will need when a document changes. Nothing enforces it on existing users
   * yet; sign-up is the only gate today.
   */
  async hasAcceptedCurrent(
    db: DbOrTx,
    userId: string,
    role: 'principal' | 'agent',
  ): Promise<boolean> {
    const row = await userConsentService.latest(db, userId);
    return row?.granted === true && row.termsVersion === requiredTermsVersion(role);
  },
};
