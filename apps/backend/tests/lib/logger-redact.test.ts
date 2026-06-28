import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { redactConfig } from '../../src/lib/logger';

function capture(obj: object): string {
  const chunks: string[] = [];
  const dest = {
    write: (s: string) => {
      chunks.push(s);
    },
  };
  const log = pino({ redact: redactConfig }, dest as unknown as NodeJS.WritableStream);
  log.info(obj, 'msg');
  return chunks.join('');
}

describe('logger PII redaction', () => {
  it('redacts phone, BVN, NIN and tokens, keeps non-sensitive fields', () => {
    const out = capture({
      phone: '+2348012345678',
      bvn: '12345678901',
      nin: '99999999999',
      refreshToken: 'secret-rt',
      authorization: 'Bearer xyz',
      userId: 'u-1',
      status: 500,
    });
    expect(out).not.toContain('+2348012345678');
    expect(out).not.toContain('12345678901');
    expect(out).not.toContain('99999999999');
    expect(out).not.toContain('secret-rt');
    expect(out).not.toContain('Bearer xyz');
    expect(out).toContain('[redacted]');
    // Non-sensitive context is preserved.
    expect(out).toContain('u-1');
    expect(out).toContain('500');
  });

  it('redacts one-level-nested PII', () => {
    const out = capture({ user: { phone: '+2348011112222', nin: '88888888888' } });
    expect(out).not.toContain('+2348011112222');
    expect(out).not.toContain('88888888888');
    expect(out).toContain('[redacted]');
  });
});
