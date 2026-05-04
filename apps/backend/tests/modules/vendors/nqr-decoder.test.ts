import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '../../../src/lib/result';
import { decodeNqr, encodeTlvForTest } from '../../../src/modules/vendors/nqr-decoder';

describe('decodeNqr', () => {
  it('decodes a minimal QR with bank code + account number under merchant info', () => {
    // Merchant info template (tag 26) contains nested TLVs for GUID (00), bankCode (01), account (02)
    const merchantInfoValue =
      encodeTlvForTest('00', 'NG.NIBSS') +
      encodeTlvForTest('01', '058') +
      encodeTlvForTest('02', '0123456789');
    const qr = encodeTlvForTest('26', merchantInfoValue);
    const result = decodeNqr(qr);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.bankCode).toBe('058');
      expect(result.value.accountNumber).toBe('0123456789');
      expect(result.value.amountKobo).toBeNull();
      expect(result.value.accountName).toBeNull();
    }
  });

  it('decodes amount (tag 54) and account name (tag 59) when present', () => {
    const merchantInfoValue =
      encodeTlvForTest('00', 'NG.NIBSS') +
      encodeTlvForTest('01', '058') +
      encodeTlvForTest('02', '0123456789');
    const qr =
      encodeTlvForTest('26', merchantInfoValue) +
      encodeTlvForTest('54', '5200.50') +
      encodeTlvForTest('59', 'MUSA ABDULLAHI');
    const result = decodeNqr(qr);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.amountKobo).toBe(520050n);
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
    }
  });

  it('returns BAD_INPUT for non-TLV garbage', () => {
    const result = decodeNqr('not-a-qr');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('BAD_INPUT');
  });

  it('returns BAD_INPUT when merchant info template is missing', () => {
    const qr = encodeTlvForTest('54', '100.00');
    const result = decodeNqr(qr);
    expect(isErr(result)).toBe(true);
  });

  it('returns BAD_INPUT when bank code or account is missing in merchant info', () => {
    const merchantInfoValue = encodeTlvForTest('00', 'NG.NIBSS') + encodeTlvForTest('01', '058');
    const qr = encodeTlvForTest('26', merchantInfoValue);
    const result = decodeNqr(qr);
    expect(isErr(result)).toBe(true);
  });
});
