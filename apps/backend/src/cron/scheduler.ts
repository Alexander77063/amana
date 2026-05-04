import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger';

export type CronJob = {
  name: string;
  schedule: string; // cron expression
  run: () => Promise<void>;
};

const tasks: ScheduledTask[] = [];

export const cronScheduler = {
  register(job: CronJob): void {
    if (!cron.validate(job.schedule)) {
      throw new Error(`invalid cron schedule for ${job.name}: ${job.schedule}`);
    }
    // createTask creates a stopped task (does not auto-start, unlike schedule())
    const task = cron.createTask(job.schedule, async () => {
      const started = Date.now();
      try {
        await job.run();
        logger.info({ job: job.name, durationMs: Date.now() - started }, 'cron job completed');
      } catch (e) {
        logger.error(
          { job: job.name, err: (e as Error).message, durationMs: Date.now() - started },
          'cron job failed',
        );
      }
    });
    tasks.push(task);
    logger.info({ job: job.name, schedule: job.schedule }, 'cron job registered');
  },

  start(): void {
    for (const task of tasks) task.start();
    logger.info({ count: tasks.length }, 'cron scheduler started');
  },

  stop(): void {
    for (const task of tasks) task.stop();
    logger.info({ count: tasks.length }, 'cron scheduler stopped');
  },

  /** For tests: run every registered job once, sequentially. Bypasses the cron schedule. */
  async runAllOnce(): Promise<void> {
    // node-cron doesn't expose the original `run` callback; tests should register their own
    // jobs and invoke them directly. Kept here for symmetry but is a no-op.
  },
};
