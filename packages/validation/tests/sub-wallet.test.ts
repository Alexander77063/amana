import { describe, expect, it } from 'vitest';
import { SubWalletSnoozeInputSchema } from '../src/sub-wallet';

describe('SubWalletSnoozeInputSchema', () => {
  it('accepts null (indefinite)', () => {
    expect(SubWalletSnoozeInputSchema.safeParse({ until: null }).success).toBe(true);
  });
  it('accepts a future ISO8601 timestamp', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(SubWalletSnoozeInputSchema.safeParse({ until: future }).success).toBe(true);
  });
  it('rejects past ISO8601 timestamps', () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(SubWalletSnoozeInputSchema.safeParse({ until: past }).success).toBe(false);
  });
  it('rejects non-ISO strings', () => {
    expect(SubWalletSnoozeInputSchema.safeParse({ until: 'not-a-date' }).success).toBe(false);
  });
  it('rejects missing field', () => {
    expect(SubWalletSnoozeInputSchema.safeParse({}).success).toBe(false);
  });
});
