import { randomInt } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { auditRepo } from '../audit';
import { usersRepo } from '../identity/users.repo';
import { deviceTokensRepo } from '../notifications/device-tokens.repo';
import { expoPushProvider } from '../notifications/providers/expo-push.provider';
import { termiiSmsProvider } from '../notifications/providers/termii-sms.provider';
import type { NotificationTarget } from '../notifications/types';
import { hashCode } from './code-hash';
import { supportVerificationsRepo } from './support-verifications.repo';

type DbOrTx = PostgresJsDatabase;

export type StartResult = {
  verificationId: string;
  matchNumber: number;
  /** Shown to the CUSTOMER alongside the match number. Never returned to the operator. */
  decoys: [number, number];
};

export type CapBreach = { capped: true; retryAfterSeconds: number };

/** Three DISTINCT two-digit numbers. Distinct because two equal options make the choice a lie. */
function threeNumbers(): { match: number; decoys: [number, number] } {
  const pool = new Set<number>();
  while (pool.size < 3) pool.add(randomInt(10, 100));
  const [match, a, b] = [...pool] as [number, number, number];
  return { match, decoys: [a, b] };
}

/**
 * Fisher-Yates over a CSPRNG. `sort(() => Math.random() - 0.5)` is NOT a shuffle — it is biased,
 * and a biased order puts the match number in a predictable slot, which is the one thing number
 * matching exists to prevent.
 */
function shuffle(values: number[]): number[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const a = out[i] as number;
    const b = out[j] as number;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export const supportVerificationService = {
  /**
   * Begin a verification. ALWAYS succeeds unless a cap is breached, and always writes a row —
   * including for a number that matches nobody, where nothing is dispatched and the row simply
   * expires. The operator cannot tell the two apart, which is the point.
   */
  async start(
    db: DbOrTx,
    input: { actorAdminUserId: string; phoneE164: string },
  ): Promise<StartResult | CapBreach> {
    const now = Date.now();

    const perOperator = await supportVerificationsRepo.countByOperatorSince(
      db,
      input.actorAdminUserId,
      new Date(now - 3_600_000),
    );
    if (perOperator >= env.SUPPORT_STARTS_PER_OPERATOR_HOUR) {
      return { capped: true, retryAfterSeconds: 3600 };
    }

    const perPhone = await supportVerificationsRepo.countByPhoneSince(
      db,
      input.phoneE164,
      new Date(now - 86_400_000),
    );
    if (perPhone >= env.SUPPORT_STARTS_PER_PHONE_DAY) {
      return { capped: true, retryAfterSeconds: 86_400 };
    }

    // Resolve, but never let the answer change the SHAPE of what we return. Retailers are out of
    // scope for support verification and are treated exactly like a stranger.
    const user = await usersRepo.findByPhone(db, input.phoneE164);
    const eligible = user && (user.role === 'principal' || user.role === 'agent') ? user : null;

    const { match, decoys } = threeNumbers();
    const tokens = eligible ? await deviceTokensRepo.listByUser(db, eligible.id) : [];
    const rail = !eligible ? 'none' : tokens.length > 0 ? 'push' : 'sms';
    const code = rail === 'sms' ? String(randomInt(100000, 1000000)) : null;

    const row = await supportVerificationsRepo.create(db, {
      adminUserId: input.actorAdminUserId,
      phoneE164: input.phoneE164,
      userId: eligible?.id ?? null,
      rail,
      matchNumber: rail === 'push' ? match : null,
      codeHash: code ? hashCode(code) : null,
      expiresAt: new Date(now + env.SUPPORT_PENDING_SECONDS * 1000),
    });

    // Straight to the provider, NOT through notificationService.dispatch. That service resolves
    // preferences, quiet hours and snooze before fanning out — correct for a settlement alert,
    // wrong here. A customer who has silenced push, or who calls at 23:00, must still receive the
    // challenge they are on the phone asking for. A security check a preference can suppress fails
    // closed against the user. Do not "tidy" this back through the service.
    if (eligible && rail !== 'none') {
      const target: NotificationTarget = {
        recipientUserId: eligible.id,
        kind: 'support_verification',
      };
      if (rail === 'push') {
        await expoPushProvider.send(db, target, {
          title: 'Amana support',
          body: 'Tap the number your support agent reads to you.',
          data: {
            kind: 'support_verification',
            verificationId: row.id,
            options: shuffle([match, ...decoys]),
          },
        });
      } else if (code) {
        await termiiSmsProvider.send(db, target, {
          title: 'Amana support',
          body: `code ${code}. Only read this to an agent YOU called. It expires in 3 minutes.`,
          // Required on RenderedNotification; SMS carries nothing structured.
          data: {},
        });
      }
    }

    await auditRepo.append(db, {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action: 'support.verification.started',
      subjectKind: 'support_verification',
      subjectId: row.id,
      // The phone is recorded. Whether it matched a customer, and which rail was used, are NOT —
      // otherwise the audit log becomes the enumeration oracle the API refuses to be.
      payloadJson: { phoneE164: input.phoneE164 },
    });

    return { verificationId: row.id, matchNumber: match, decoys };
  },
};
