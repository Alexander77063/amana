import { describe, expect, it, vi } from 'vitest';
import { adminApprovalSweepJob } from '../../src/cron/jobs/admin-approval-sweep.job';
import { adminApprovalService } from '../../src/modules/admin/admin-approval.service';

describe('adminApprovalSweepJob', () => {
  it('runs hourly', () => {
    // Hourly, not per-minute like the bump sweep: the TTL is seven days and nothing here is
    // time-critical to the minute. A customer waiting on a bump is; a week-old role request is not.
    expect(adminApprovalSweepJob.schedule).toBe('0 * * * *');
    expect(adminApprovalSweepJob.name).toBe('admin-approval-sweep');
  });

  it('run() invokes adminApprovalService.sweepExpired', async () => {
    const spy = vi.spyOn(adminApprovalService, 'sweepExpired').mockResolvedValue(0);
    await adminApprovalSweepJob.run();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
