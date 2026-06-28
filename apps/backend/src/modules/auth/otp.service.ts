import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import * as codes from './codes';
import { otpChallengesRepo } from './otp-challenges.repo';
import type { OtpPurpose } from './types';

type DbOrTx = PostgresJsDatabase;

export type RequestCodeInput = { phone: string; purpose: OtpPurpose };
export type RequestCodeResult = { challengeId: string; expiresAt: Date };

export type VerifyCodeInput = { phone: string; code: string };
export type VerifyCodeResult =
  | { kind: 'verified'; challengeId: string; purpose: OtpPurpose }
  | { kind: 'no_challenge' }
  | { kind: 'too_many_attempts' }
  | { kind: 'wrong_code' };

async function sendSms(phone: string, code: string): Promise<void> {
  if (!env.TERMII_API_KEY) {
    logger.warn({ phone }, 'otp: TERMII_API_KEY not set, skipping send');
    return;
  }
  const res = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      to: phone,
      from: env.TERMII_SENDER_ID,
      sms: `Your Amana verification code is ${code}. Expires in 5 minutes.`,
      type: 'plain',
      channel: 'generic',
      api_key: env.TERMII_API_KEY,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error({ phone, status: res.status, body }, 'otp: termii send failed');
    throw new Error(`termii: ${res.status}`);
  }
}

export const otpService = {
  async requestCode(db: DbOrTx, input: RequestCodeInput): Promise<RequestCodeResult> {
    const now = new Date();
    const bypass = env.DEV_OTP_BYPASS_CODE;
    const code = bypass ?? codes.generateOtpCode();
    const codeHash = await codes.hashCode(code);
    const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);

    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      await otpChallengesRepo.invalidateActiveForPhone(txDb, input.phone, now);
      const ch = await otpChallengesRepo.insert(txDb, {
        phone: input.phone,
        codeHash,
        purpose: input.purpose,
        expiresAt,
      });
      if (bypass) {
        logger.warn({ phone: input.phone }, 'otp: DEV_OTP_BYPASS_CODE active — SMS skipped');
      } else {
        await sendSms(input.phone, code);
      }
      return { challengeId: ch.id, expiresAt };
    });
  },

  async verifyCode(db: DbOrTx, input: VerifyCodeInput): Promise<VerifyCodeResult> {
    const now = new Date();
    const ch = await otpChallengesRepo.findActiveByPhone(db, input.phone, now);
    if (!ch) return { kind: 'no_challenge' as const };
    // Atomically claim an attempt slot before checking the code — this is the
    // real brute-force cap; concurrent verifies can never exceed OTP_MAX_ATTEMPTS.
    const claimed = await otpChallengesRepo.claimAttempt(db, ch.id, env.OTP_MAX_ATTEMPTS, now);
    if (claimed === undefined) return { kind: 'too_many_attempts' as const };
    const ok = await codes.verifyCode(input.code, ch.codeHash);
    if (!ok) return { kind: 'wrong_code' as const };
    await otpChallengesRepo.markConsumed(db, ch.id, now);
    return { kind: 'verified' as const, challengeId: ch.id, purpose: ch.purpose };
  },
};
