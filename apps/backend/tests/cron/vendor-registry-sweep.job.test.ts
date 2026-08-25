import { describe, expect, it, vi } from 'vitest';
import { vendorRegistrySweepJob } from '../../src/cron/jobs/vendor-registry-sweep.job';
import { vendorRegistryService } from '../../src/modules/vendors/vendor-registry.service';

describe('vendorRegistrySweepJob', () => {
  it('is named and scheduled hourly, off the top of the hour', () => {
    expect(vendorRegistrySweepJob.name).toBe('vendor-registry-sweep');
    expect(vendorRegistrySweepJob.schedule).toBe('17 * * * *');
  });

  it('run() invokes the sweep with config drawn from env', async () => {
    const spy = vi
      .spyOn(vendorRegistryService, 'sweep')
      .mockResolvedValue({ promoted: 0, categorised: 0, pruned: 0 });

    await vendorRegistrySweepJob.run();

    expect(spy).toHaveBeenCalledTimes(1);
    const cfg = spy.mock.calls[0]?.[2];
    expect(cfg?.minHouseholds).toBe(5);
    expect(cfg?.consensusMinHouseholds).toBe(8);
    expect(cfg?.consensusRatio).toBe(0.6);
    expect(cfg?.retentionDays).toBe(180);
    expect(cfg?.sensitiveCategories).toContain('pharmacy');
    spy.mockRestore();
  });
});
