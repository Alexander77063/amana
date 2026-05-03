import { describe, expect, it } from 'vitest';
import { logger } from '../src/lib/logger';

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
});
