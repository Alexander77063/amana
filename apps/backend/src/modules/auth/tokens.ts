import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../env';
import type { AccessTokenClaims } from './types';

const secretKey = (): Uint8Array => new TextEncoder().encode(env.JWT_SECRET);

export type SignAccessInput = {
  userId: string;
  role: 'principal' | 'agent';
  sessionId: string;
  now?: Date;
};

export async function signAccessToken(
  input: SignAccessInput,
): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + env.JWT_ACCESS_TTL_SECONDS;
  const jti = randomUUID();
  const token = await new SignJWT({ role: input.role, sid: input.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.userId)
    .setIssuer(env.JWT_ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(secretKey());
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: env.JWT_ISSUER,
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string') throw new Error('jwt: missing sub');
  if (typeof payload.sid !== 'string') throw new Error('jwt: missing sid');
  if (payload.role !== 'principal' && payload.role !== 'agent') throw new Error('jwt: bad role');
  return {
    sub: payload.sub,
    role: payload.role,
    sid: payload.sid,
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
    iss: payload.iss as string,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function hashRefreshToken(refresh: string): Promise<string> {
  return argon2.hash(refresh, { type: argon2.argon2id });
}

export async function verifyRefreshToken(refresh: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, refresh);
  } catch {
    return false;
  }
}
