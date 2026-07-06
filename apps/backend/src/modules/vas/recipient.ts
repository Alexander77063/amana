/**
 * Normalize a recipient value for comparison/storage so the allowlist cannot be
 * spoofed by formatting. Phones collapse to `+234`-prefixed digits (local
 * `0801…`, international `+234801…`, and bare `234801…` all map to one value);
 * meters/smartcards reduce to their trimmed digits.
 */
export function normalizeRecipient(kind: 'phone' | 'meter' | 'smartcard', raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (kind !== 'phone') return digits;
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}
