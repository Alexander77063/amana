import { describe, expect, it } from 'vitest';
import { decryptField, encryptField } from '../../src/lib/field-crypto';

describe('field encryption (BVN/NIN at rest)', () => {
  it('round-trips a value and the ciphertext does not contain the plaintext', () => {
    const pt = '12345678901';
    const blob = encryptField(pt);
    expect(blob).not.toContain(pt);
    expect(decryptField(blob)).toBe(pt);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptField('12345678901')).not.toBe(encryptField('12345678901'));
  });

  it('rejects a tampered ciphertext (GCM auth)', () => {
    const blob = encryptField('secret-nin');
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
    expect(() => decryptField(buf.toString('base64'))).toThrow();
  });
});
