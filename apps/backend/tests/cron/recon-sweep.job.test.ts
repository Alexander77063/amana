import { describe, expect, it, vi } from 'vitest';
import { reconSweepJob } from '../../src/cron/jobs/recon-sweep.job';
import { reconciliationService } from '../../src/modules/transactions/reconciliation.service';

describe('reconSweepJob', () => {
  it('schedule is */5 * * * *', () => {
    expect(reconSweepJob.schedule).toBe('*/5 * * * *');
    expect(reconSweepJob.name).toBe('recon-sweep');
  });

  it('run() invokes reconciliationService.sweep', async () => {
    const spy = vi.spyOn(reconciliationService, 'sweep').mockResolvedValue({
      inspected: 0,
      settled: 0,
      reversed: 0,
      stillPending: 0,
      unknown: 0,
    });
    await reconSweepJob.run();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
