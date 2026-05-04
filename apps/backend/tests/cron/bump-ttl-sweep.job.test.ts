import { describe, expect, it, vi } from 'vitest';
import { bumpTtlSweepJob } from '../../src/cron/jobs/bump-ttl-sweep.job';
import { bumpWorkflowService } from '../../src/modules/bumps/bump-workflow.service';

describe('bumpTtlSweepJob', () => {
  it('schedule is * * * * *', () => {
    expect(bumpTtlSweepJob.schedule).toBe('* * * * *');
    expect(bumpTtlSweepJob.name).toBe('bump-ttl-sweep');
  });

  it('run() invokes bumpWorkflowService.sweepExpired', async () => {
    const spy = vi
      .spyOn(bumpWorkflowService, 'sweepExpired')
      .mockResolvedValue({ expiredCount: 0 });
    await bumpTtlSweepJob.run();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
