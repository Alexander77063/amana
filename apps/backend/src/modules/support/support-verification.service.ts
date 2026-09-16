import { randomInt } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit';
import { usersRepo } from '../identity/users.repo';
import { deviceTokensRepo } from '../notifications/device-tokens.repo';
import { expoPushProvider } from '../notifications/providers/expo-push.provider';
import { termiiSmsProvider } from '../notifications/providers/termii-sms.provider';
import type { NotificationTarget } from '../notifications/types';
import { codeMatches, hashCode } from './code-hash';
import {
  type SupportVerificationRow,
  supportVerificationsRepo,
} from './support-verifications.repo';

type DbOrTx = PostgresJsDatabase;

export type StartResult = {
  verificationId: string;
  matchNumber: number;
  /** Shown to the CUSTOMER alongside the match number. Never returned to the operator. */
  decoys: [number, number];
};

export type CapBreach = { capped: true; retryAfterSeconds: number };

export type RespondOutcome = 'verified' | 'denied' | 'expired' | 'not_found';

/** Thrown by `requireLiveSession`. Every read endpoint turns this into a 403. */
export class SupportSessionError extends Error {
  constructor() {
    super('no live verified support session');
    this.name = 'SupportSessionError';
  }
}

/**
 * Map a non-pending status to an outcome EXPLICITLY.
 *
 * This was a `status === 'verified' ? 'verified' : 'denied'` ternary, which is right only while
 * nothing ever writes `'expired'` — nothing does today, because there is no sweep job. The moment
 * anyone adds one, the ternary starts reporting expired rows as `denied`, the apps' "that request
 * timed out" copy goes dead, and customers are told "that did not match" instead. Enumerating the
 * statuses means the compiler will object when a new one appears rather than silently mislabelling.
 */
function settledOutcome(status: 'verified' | 'denied' | 'expired'): RespondOutcome {
  switch (status) {
    case 'verified':
      return 'verified';
    case 'expired':
      return 'expired';
    case 'denied':
      return 'denied';
  }
}

/** SMS codes get three attempts; a misheard digit over a bad line is ordinary. Push gets one. */
const SMS_MAX_ATTEMPTS = 3;

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

/**
 * A cap breach is an event, not a silent refusal.
 *
 * The per-phone cap is deliberately global across operators, which means one member of staff can
 * burn a customer's daily quota and leave them unable to be verified — a denial of service on
 * support, by an insider. The cap still earns its place (it is what stops an SMS-spend vector
 * pointed at arbitrary numbers), so the mitigation is visibility rather than removal: every breach
 * names the operator and the number, so the pattern is answerable from the audit log.
 */
async function auditCapBreach(
  db: DbOrTx,
  input: { actorAdminUserId: string; phoneE164: string },
  cap: 'operator_hourly' | 'phone_daily',
): Promise<void> {
  await auditRepo.append(db, {
    actorKind: 'ops',
    actorAdminUserId: input.actorAdminUserId,
    action: 'support.verification.capped',
    // `audit_log.subject_id` is a uuid column, so the SUBJECT is the operator who breached the
    // cap and the number travels in the payload — which is also the more useful shape, since the
    // question this row answers is "who is burning quota", not "what happened to this number".
    subjectKind: 'admin_user',
    subjectId: input.actorAdminUserId,
    payloadJson: { cap, phoneE164: input.phoneE164 },
  });
}

/**
 * Send the challenge. Never awaited by `start` — see the comment at its call site.
 *
 * Push is attempted first when the customer has a device token, but a token row proves nothing
 * about deliverability: `device_tokens` has no revoked column and nothing prunes it, so a
 * reinstalled or replaced phone leaves a dead row behind for ever. If Expo accepts NOTHING we fall
 * through to SMS rather than leaving the customer waiting on a notification that cannot arrive.
 */
async function dispatch(input: {
  db: DbOrTx;
  userId: string;
  rail: 'push' | 'sms';
  verificationId: string;
  options: number[];
  code: string | null;
}): Promise<void> {
  const target: NotificationTarget = {
    recipientUserId: input.userId,
    kind: 'support_verification',
  };
  const smsBody = (code: string) =>
    `code ${code}. Only read this to an agent YOU called. It expires in 3 minutes.`;

  try {
    if (input.rail === 'push') {
      const result = await expoPushProvider.send(input.db, target, {
        title: 'Amana support',
        body: 'Tap the number your support agent reads to you.',
        data: {
          kind: 'support_verification',
          verificationId: input.verificationId,
          options: input.options,
        },
      });
      if (result.accepted > 0) return;

      // Nothing was accepted — stale tokens. Fall back so the verification is still answerable.
      logger.warn(
        { verificationId: input.verificationId, attempted: result.attempted },
        'support: push accepted by nobody, falling back to sms',
      );
      const fallback = String(randomInt(100000, 1000000));
      await supportVerificationsRepo.attachSmsFallback(input.db, input.verificationId, {
        codeHash: hashCode(fallback),
      });
      await termiiSmsProvider.send(input.db, target, {
        title: 'Amana support',
        body: smsBody(fallback),
        data: {},
      });
      return;
    }

    if (input.code) {
      await termiiSmsProvider.send(input.db, target, {
        title: 'Amana support',
        body: smsBody(input.code),
        // Required on RenderedNotification; SMS carries nothing structured.
        data: {},
      });
    }
  } catch (e) {
    // A dispatch failure must not take down the request that already returned 202. The
    // verification simply expires, which is indistinguishable from an unanswered call — the same
    // shape the no-match path produces.
    logger.error(
      { err: (e as Error).message, verificationId: input.verificationId },
      'support: verification dispatch failed',
    );
  }
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
      await auditCapBreach(db, input, 'operator_hourly');
      return { capped: true, retryAfterSeconds: 3600 };
    }

    const perPhone = await supportVerificationsRepo.countByPhoneSince(
      db,
      input.phoneE164,
      new Date(now - 86_400_000),
    );
    if (perPhone >= env.SUPPORT_STARTS_PER_PHONE_DAY) {
      await auditCapBreach(db, input, 'phone_daily');
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
    //
    // And NOT awaited. Awaiting a live HTTP call to Expo or Termii makes response latency the
    // enumeration oracle this whole feature is built to deny: a number matching nobody returns in
    // milliseconds, a real customer's waits on the network, and five samples separate those
    // distributions comfortably. Dispatch is fire-and-forget with failures logged.
    if (eligible && rail !== 'none') {
      void dispatch({
        db,
        userId: eligible.id,
        rail,
        verificationId: row.id,
        options: shuffle([match, ...decoys]),
        code,
      });
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

  /**
   * The customer's half of number matching. One attempt: a one-in-three guess must not be
   * retryable, so a wrong tap denies the verification outright rather than costing an attempt.
   */
  async respondFromCustomer(
    db: DbOrTx,
    input: { verificationId: string; userId: string; chosenNumber: number },
  ): Promise<RespondOutcome> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    // A verification addressed to somebody else is "not found", never "wrong customer" — the
    // caller must not learn that the id exists.
    if (!row || row.userId !== input.userId) return 'not_found';
    if (row.status !== 'pending') return settledOutcome(row.status);
    if (row.expiresAt.getTime() <= Date.now()) return 'expired';

    if (row.matchNumber !== input.chosenNumber) {
      await supportVerificationsRepo.markDenied(db, row.id);
      await auditRepo.append(db, {
        actorKind: 'user',
        actorUserId: input.userId,
        action: 'support.verification.denied',
        subjectKind: 'support_verification',
        subjectId: row.id,
        payloadJson: { reason: 'wrong_number' },
      });
      return 'denied';
    }

    const verified = await supportVerificationsRepo.markVerified(
      db,
      row.id,
      new Date(Date.now() + env.SUPPORT_SESSION_SECONDS * 1000),
    );
    // Null means somebody else moved this row between the read and the write. Losing that race is
    // a denial, not a silent success.
    if (!verified) return 'denied';

    await auditRepo.append(db, {
      actorKind: 'user',
      actorUserId: input.userId,
      action: 'support.verification.verified',
      subjectKind: 'support_verification',
      subjectId: row.id,
      payloadJson: { rail: row.rail },
    });
    return 'verified';
  },

  /** The SMS half: the customer reads a code out, the operator types it in. Three attempts. */
  async confirmCode(
    db: DbOrTx,
    input: { verificationId: string; actorAdminUserId: string; code: string },
  ): Promise<RespondOutcome> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    if (!row || row.adminUserId !== input.actorAdminUserId) return 'not_found';
    if (row.status !== 'pending') return settledOutcome(row.status);
    if (row.expiresAt.getTime() <= Date.now()) return 'expired';

    // A code typed against a PUSH verification has no hash to compare. Spend an attempt anyway
    // rather than returning a bare denial: without this the row never terminates, and an operator
    // could sit typing codes at a verification that can only ever be answered by a tap.
    if (!row.codeHash) {
      const attempts = await supportVerificationsRepo.incrementAttempts(db, row.id);
      if (attempts >= SMS_MAX_ATTEMPTS) await supportVerificationsRepo.markDenied(db, row.id);
      return 'denied';
    }

    if (!codeMatches(input.code, row.codeHash)) {
      const attempts = await supportVerificationsRepo.incrementAttempts(db, row.id);
      if (attempts >= SMS_MAX_ATTEMPTS) await supportVerificationsRepo.markDenied(db, row.id);
      return 'denied';
    }

    const verified = await supportVerificationsRepo.markVerified(
      db,
      row.id,
      new Date(Date.now() + env.SUPPORT_SESSION_SECONDS * 1000),
    );
    if (!verified) return 'denied';

    await auditRepo.append(db, {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action: 'support.verification.verified',
      subjectKind: 'support_verification',
      subjectId: row.id,
      payloadJson: { rail: row.rail },
    });
    return 'verified';
  },

  /** Status for the operator's screen. Null when the row belongs to somebody else. */
  async readStatus(
    db: DbOrTx,
    input: { verificationId: string; actorAdminUserId: string },
  ): Promise<{ status: string; expiresAt: string; sessionExpiresAt: string | null } | null> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    if (!row || row.adminUserId !== input.actorAdminUserId) return null;
    // Report a lapsed pending row as expired without waiting for a sweep to write it.
    const lapsed = row.status === 'pending' && row.expiresAt.getTime() <= Date.now();
    return {
      status: lapsed ? 'expired' : row.status,
      expiresAt: row.expiresAt.toISOString(),
      sessionExpiresAt: row.sessionExpiresAt?.toISOString() ?? null,
    };
  },

  /**
   * The gate every support read goes through. Bound to the operator who started the verification:
   * a verified session is not a token a second member of staff can pick up.
   */
  async requireLiveSession(
    db: DbOrTx,
    input: { verificationId: string; actorAdminUserId: string },
  ): Promise<SupportVerificationRow> {
    const row = await supportVerificationsRepo.findById(db, input.verificationId);
    if (!row || row.adminUserId !== input.actorAdminUserId) throw new SupportSessionError();
    if (row.status !== 'verified' || !row.userId) throw new SupportSessionError();
    if (!row.sessionExpiresAt || row.sessionExpiresAt.getTime() <= Date.now()) {
      throw new SupportSessionError();
    }
    return row;
  },
};
