import { describe, expect, it } from 'vitest';
import { factories } from './factories';

describe('factories', () => {
  it('produces an 11-digit BVN', () => {
    expect(factories.bvn()).toMatch(/^\d{11}$/);
  });
  it('produces an 11-digit NIN', () => {
    expect(factories.nin()).toMatch(/^\d{11}$/);
  });
  it('produces a 10-digit bank account', () => {
    expect(factories.bankAccount()).toMatch(/^\d{10}$/);
  });
  it('produces an E.164 Nigerian phone', () => {
    expect(factories.phone()).toMatch(/^\+234\d+$/);
  });
  it('converts naira to kobo as bigint', () => {
    expect(factories.kobo(150)).toBe(15000n);
    expect(factories.kobo(0.5)).toBe(50n);
  });
});
