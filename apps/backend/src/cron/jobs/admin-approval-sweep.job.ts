import { db } from '../../db/client';
import { adminApprovalService } from '../../modules/admin/admin-approval.service';
import type { CronJob } from '../scheduler';

/**
 * Expire maker-checker proposals nobody decided.
 *
 * Hourly rather than per-minute, unlike `bump-ttl-sweep`: the TTL is seven days, and nothing about
 * an admin approval is time-critical to the minute. A customer waiting on a bump is; a role grant
 * request that has sat for a week is not.
 *
 * The expiry is WRITTEN as a status transition rather than computed at read time, which is the
 * whole reason this job exists. A `pending` row that has silently stopped working is a row an
 * operator will keep clicking approve on, with nothing to explain why nothing happens.
 */
export const adminApprovalSweepJob: CronJob = {
  name: 'admin-approval-sweep',
  schedule: '0 * * * *', // hourly, on the hour
  async run() {
    await adminApprovalService.sweepExpired(db, new Date());
  },
};
