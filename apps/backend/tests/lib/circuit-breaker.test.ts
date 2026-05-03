import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../../src/lib/circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-05-03T00:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes calls through when closed', async () => {
    const cb = new CircuitBreaker({
      failureRateThreshold: 0.5,
      windowMs: 60_000,
      openMs: 30_000,
      minSamples: 5,
    });
    const result = await cb.exec(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.state).toBe('closed');
  });

  it('opens after failure rate exceeds threshold within window', async () => {
    const cb = new CircuitBreaker({
      failureRateThreshold: 0.5,
      windowMs: 60_000,
      openMs: 30_000,
      minSamples: 4,
    });
    // 4 failures in a row → 100% > 50% → open
    for (let i = 0; i < 4; i++) {
      await cb
        .exec(async () => {
          throw new Error('boom');
        })
        .catch(() => undefined);
    }
    expect(cb.state).toBe('open');
  });

  it('rejects with CircuitOpenError while open', async () => {
    const cb = new CircuitBreaker({
      failureRateThreshold: 0.5,
      windowMs: 60_000,
      openMs: 30_000,
      minSamples: 2,
    });
    for (let i = 0; i < 2; i++) {
      await cb
        .exec(async () => {
          throw new Error('boom');
        })
        .catch(() => undefined);
    }
    await expect(cb.exec(async () => 'ok')).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('half-opens after openMs and closes on success', async () => {
    const cb = new CircuitBreaker({
      failureRateThreshold: 0.5,
      windowMs: 60_000,
      openMs: 30_000,
      minSamples: 2,
    });
    for (let i = 0; i < 2; i++) {
      await cb
        .exec(async () => {
          throw new Error('boom');
        })
        .catch(() => undefined);
    }
    expect(cb.state).toBe('open');
    vi.advanceTimersByTime(30_001);
    const result = await cb.exec(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.state).toBe('closed');
  });

  it('does not open before minSamples is reached', async () => {
    const cb = new CircuitBreaker({
      failureRateThreshold: 0.5,
      windowMs: 60_000,
      openMs: 30_000,
      minSamples: 5,
    });
    // 3 failures, below minSamples=5 → still closed
    for (let i = 0; i < 3; i++) {
      await cb
        .exec(async () => {
          throw new Error('boom');
        })
        .catch(() => undefined);
    }
    expect(cb.state).toBe('closed');
  });
});
