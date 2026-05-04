import { describe, expect, it } from 'vitest';
import { type CronJob, cronScheduler } from '../../src/cron';

describe('cronScheduler', () => {
  it('throws on invalid cron expression', () => {
    const bad: CronJob = { name: 'bad', schedule: 'not-a-cron', run: async () => {} };
    expect(() => cronScheduler.register(bad)).toThrow(/invalid cron/);
  });

  it('register accepts valid cron expressions', () => {
    const ok: CronJob = { name: 'ok', schedule: '*/5 * * * *', run: async () => {} };
    expect(() => cronScheduler.register(ok)).not.toThrow();
  });
});
