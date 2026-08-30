import { cronScheduler } from '../src/cron';
import { adminApprovalSweepJob } from '../src/cron/jobs/admin-approval-sweep.job';
import { bumpTtlSweepJob } from '../src/cron/jobs/bump-ttl-sweep.job';
import { reconSweepJob } from '../src/cron/jobs/recon-sweep.job';
import { vendorRegistrySweepJob } from '../src/cron/jobs/vendor-registry-sweep.job';
import { voucherExpirySweepJob } from '../src/cron/jobs/voucher-expiry-sweep.job';
import { closeDb } from '../src/db/client';
import { logger } from '../src/lib/logger';

cronScheduler.register(reconSweepJob);
cronScheduler.register(bumpTtlSweepJob);
cronScheduler.register(vendorRegistrySweepJob);
cronScheduler.register(voucherExpirySweepJob);
cronScheduler.register(adminApprovalSweepJob);
cronScheduler.start();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'cron worker shutting down');
  cronScheduler.stop();
  try {
    await closeDb(); // drain the Postgres pool on shutdown
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'error closing db on shutdown');
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('uncaughtException', (e) => {
  logger.error({ err: e.message, stack: e.stack }, 'cron worker uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'cron worker unhandled rejection');
  process.exit(1);
});

logger.info('cron worker ready');
