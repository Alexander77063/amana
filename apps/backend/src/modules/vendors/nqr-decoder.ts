import { err, ok, type Result } from '../../lib/result';
import { fromNairaString, kobo, type Kobo } from '../../lib/kobo';

export type DecodedNqr = {
  bankCode: string;
  accountNumber: string;
  accountName: string | null;
  amountKobo: Kobo | null;
};

export type NqrError = { code: 'BAD_INPUT'; message: string };

const TAG_MERCHANT_INFO = '26';
const TAG_AMOUNT = '54';
const TAG_ACCOUNT_NAME = '59';
const SUBTAG_BANK_CODE = '01';
const SUBTAG_ACCOUNT_NUMBER = '02';

type TlvMap = Map<string, string>;

function parseTlv(input: string): TlvMap | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < input.length) {
    if (input.length - i < 4) return null;
    const tag = input.slice(i, i + 2);
    const len = Number.parseInt(input.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len) || i + 4 + len > input.length) return null;
    const value = input.slice(i + 4, i + 4 + len);
    out.set(tag, value);
    i += 4 + len;
  }
  return out;
}

export function decodeNqr(qr: string): Result<DecodedNqr, NqrError> {
  const top = parseTlv(qr);
  if (!top) return err({ code: 'BAD_INPUT', message: 'malformed top-level TLV' });

  const merchantInfo = top.get(TAG_MERCHANT_INFO);
  if (!merchantInfo) return err({ code: 'BAD_INPUT', message: 'missing merchant info template (tag 26)' });

  const inner = parseTlv(merchantInfo);
  if (!inner) return err({ code: 'BAD_INPUT', message: 'malformed merchant info template' });

  const bankCode = inner.get(SUBTAG_BANK_CODE);
  const accountNumber = inner.get(SUBTAG_ACCOUNT_NUMBER);
  if (!bankCode) return err({ code: 'BAD_INPUT', message: 'missing bank code (subtag 01)' });
  if (!accountNumber) return err({ code: 'BAD_INPUT', message: 'missing account number (subtag 02)' });

  const amountStr = top.get(TAG_AMOUNT);
  let amountKobo: Kobo | null = null;
  if (amountStr) {
    try {
      amountKobo = fromNairaString(amountStr);
    } catch (e) {
      return err({ code: 'BAD_INPUT', message: `bad amount: ${(e as Error).message}` });
    }
  }

  const accountName = top.get(TAG_ACCOUNT_NAME) ?? null;

  return ok({
    bankCode,
    accountNumber,
    accountName,
    amountKobo,
  });
}

/** Test helper: encode a single TLV. Exported so tests can construct QR strings deterministically. */
export function encodeTlvForTest(tag: string, value: string): string {
  if (tag.length !== 2) throw new Error(`tag must be 2 chars: ${tag}`);
  const len = String(value.length).padStart(2, '0');
  if (len.length !== 2) throw new Error(`value too long for 2-digit length: ${value.length}`);
  return `${tag}${len}${value}`;
}
