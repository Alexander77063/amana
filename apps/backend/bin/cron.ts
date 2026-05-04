import { cronScheduler } from '../src/cron';
import { bumpTtlSweepJob } from '../src/cron/jobs/bump-ttl-sweep.job';
import { reconSweepJob } from '../src/cron/jobs/recon-sweep.job';
import { logger } from '../src/lib/logger';

cronScheduler.register(reconSweepJob);
cronScheduler.register(bumpTtlSweepJob);
cronScheduler.start();

const shutdown = (signal: string) => {
  logger.info({ signal }, 'cron worker shutting down');
  cronScheduler.stop();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (e) => {
  logger.error({ err: e.message, stack: e.stack }, 'cron worker uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'cron worker unhandled rejection');
  process.exit(1);
});

logger.info('cron worker ready');
