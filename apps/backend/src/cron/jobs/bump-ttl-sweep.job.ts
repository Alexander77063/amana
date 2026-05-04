import { db } from '../../db/client';
import { bumpWorkflowService } from '../../modules/bumps/bump-workflow.service';
import type { CronJob } from '../scheduler';

export const bumpTtlSweepJob: CronJob = {
  name: 'bump-ttl-sweep',
  schedule: '* * * * *', // every minute
  async run() {
    await bumpWorkflowService.sweepExpired(db, new Date());
  },
};
