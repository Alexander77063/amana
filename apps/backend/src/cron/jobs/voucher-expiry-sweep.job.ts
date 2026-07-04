import { db } from '../../db/client';
import { expiryService } from '../../modules/marketplace/expiry.service';
import type { CronJob } from '../scheduler';

export const voucherExpirySweepJob: CronJob = {
  name: 'voucher-expiry-sweep',
  schedule: '* * * * *', // every minute
  async run() {
    await expiryService.sweepExpired(db, new Date());
  },
};
