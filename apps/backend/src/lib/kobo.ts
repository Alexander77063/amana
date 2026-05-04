declare const KoboBrand: unique symbol;
export type Kobo = bigint & { readonly [KoboBrand]: 'kobo' };

export const kobo = (value: bigint): Kobo => value as Kobo;
export const zeroKobo: Kobo = kobo(0n);

const NAIRA_REGEX = /^(\d+)(?:\.(\d{1,2}))?$/;

export function fromNairaString(input: string): Kobo {
  if (input.startsWith('-')) throw new Error('negative naira not allowed');
  const match = NAIRA_REGEX.exec(input);
  if (!match) throw new Error(`invalid naira string (max 2 decimals): ${input}`);
  const whole = BigInt(match[1] ?? '0');
  const fracRaw = match[2] ?? '';
  const frac = fracRaw.length === 1 ? `${fracRaw}0` : fracRaw.padEnd(2, '0');
  return kobo(whole * 100n + BigInt(frac || '0'));
}

export function toNairaString(value: Kobo): string {
  const naira = value / 100n;
  const k = value % 100n;
  const nairaStr = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const koboStr = k.toString().padStart(2, '0');
  return `${nairaStr}.${koboStr}`;
}

export function formatNaira(amountKobo: bigint): string {
  const naira = amountKobo / 100n;
  const remainderKobo = amountKobo % 100n;
  const intPart = naira.toLocaleString('en-NG'); // "5,200"
  if (remainderKobo === 0n) return `₦${intPart}`;
  const dec = remainderKobo.toString().padStart(2, '0');
  return `₦${intPart}.${dec}`;
}
