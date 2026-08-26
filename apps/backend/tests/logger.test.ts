import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { logger, redactConfig } from '../src/lib/logger';

/**
 * Log through a REAL pino instance carrying the production `redactConfig`, and read what actually
 * came out the other end.
 *
 * This shape is the point of the file. The obvious way to test redaction is
 * `vi.spyOn(logger, 'warn')` and assert on the object passed in — and that proves nothing, because
 * the spy intercepts the call BEFORE pino applies `redact`. A test written that way passes whether
 * or not the field is on the list, so it stays green while the field it claims to protect is
 * leaking. That is not hypothetical: a review found `accountNumber` reaching the logs in the clear
 * with exactly such a test standing green over it.
 */
function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, log: pino({ base: null, redact: redactConfig }, stream) };
}

describe('logger', () => {
  it('exposes pino-compatible level methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('uses base service field', () => {
    const bindings = logger.bindings();
    expect(bindings.service).toBe('amana-backend');
  });

  describe('redaction — asserted on the emitted line, not the call site', () => {
    it('censors every identifier on the list, at top level and one deep', () => {
      const { lines, log } = captureLogger();
      const secrets = {
        phone: '+2348011000008',
        bvn: '22222222222',
        nin: '11111111111',
        accountNumber: '0123456789',
        accessToken: 'at-live-value',
        refreshToken: 'rt-live-value',
        pairingCode: 'PAIR-123456',
        authorization: 'Bearer live-value',
      };
      log.warn({ ...secrets, nested: { ...secrets } }, 'enquiry failed');

      const line = lines.join('');
      for (const [field, value] of Object.entries(secrets)) {
        // Both the bare value and the field's censored form, so a partial match cannot pass this.
        expect(line, `${field} leaked at top level`).not.toContain(value);
      }
      const out = JSON.parse(line);
      for (const field of Object.keys(secrets)) {
        expect(out[field], `${field} not censored at top level`).toBe('[redacted]');
        expect(out.nested[field], `${field} not censored one level deep`).toBe('[redacted]');
      }
    });

    it('leaves a non-identifier field intact — so the test above cannot pass by censoring everything', () => {
      // Without this, a `redact` config that censored every key would satisfy the first test while
      // destroying the logs' usefulness. `bankCode` is deliberately NOT an identifier on its own:
      // it names an institution, not a person, and an operator needs it to debug a failed enquiry.
      const { lines, log } = captureLogger();
      log.warn({ bankCode: '058', accountNumber: '0123456789' }, 'enquiry failed');

      const out = JSON.parse(lines.join(''));
      expect(out.bankCode).toBe('058');
      expect(out.accountNumber).toBe('[redacted]');
    });

    it('pins accountNumber specifically, because it was added after it leaked', () => {
      // Regression guard. `routes/vendors.ts` passes the payee account number as a named log field
      // on the enquiry-failure path. It rode that mechanism unprotected until a review caught it —
      // the commit that stopped a phone being interpolated into a log MESSAGE moved identifiers to
      // named FIELDS, correctly, but only `phone` was on the redact list.
      expect(redactConfig.paths).toContain('accountNumber');
      expect(redactConfig.paths).toContain('*.accountNumber');
    });
  });
});
