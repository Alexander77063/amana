/**
 * Returns "***NNNN" with last 4 digits, or "***<all>" for shorter inputs.
 * Returns null for null/empty input — receipt UI hides the whole row.
 */
export function maskAccount(account: string | null): string | null {
  if (!account) return null;
  if (account.length <= 4) return `***${account}`;
  return `***${account.slice(-4)}`;
}
