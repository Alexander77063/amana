import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function hashCode(code: string): Promise<string> {
  return argon2.hash(code, { type: argon2.argon2id });
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, code);
  } catch {
    return false;
  }
}
