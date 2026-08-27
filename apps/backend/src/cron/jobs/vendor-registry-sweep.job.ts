import { db } from '../../db/client';
import { env } from '../../env';
import { vendorRegistryService } from '../../modules/vendors/vendor-registry.service';
import type { CronJob } from '../scheduler';

export const vendorRegistrySweepJob: CronJob = {
  name: 'vendor-registry-sweep',
  // Hourly at :17 rather than :00 — the recon sweep already runs on every fifth minute including
  // the top of the hour, and there is no reason to stack a full-table scan on top of it.
  schedule: '17 * * * *',
  async run() {
    await vendorRegistryService.sweep(db, new Date(), {
      minHouseholds: env.VENDOR_REGISTRY_MIN_HOUSEHOLDS,
      consensusMinHouseholds: env.VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS,
      consensusRatio: env.VENDOR_REGISTRY_CONSENSUS_RATIO,
      sensitiveCategories: env.VENDOR_SENSITIVE_CATEGORIES,
      retentionDays: env.VENDOR_OBSERVATION_RETENTION_DAYS,
    });
  },
};
