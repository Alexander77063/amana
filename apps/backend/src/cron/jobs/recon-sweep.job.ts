import { db } from '../../db/client';
import { env } from '../../env';
import { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorClient } from '../../integrations/anchor/client';
import { reconciliationService } from '../../modules/transactions/reconciliation.service';
import type { CronJob } from '../scheduler';

export const reconSweepJob: CronJob = {
  name: 'recon-sweep',
  schedule: '*/5 * * * *', // every 5 minutes
  async run() {
    const adapter = new AnchorAdapter({
      db,
      client: new AnchorClient({ baseUrl: env.ANCHOR_API_BASE_URL, apiKey: env.ANCHOR_API_KEY }),
    });
    await reconciliationService.sweep(db, adapter, new Date());
  },
};
