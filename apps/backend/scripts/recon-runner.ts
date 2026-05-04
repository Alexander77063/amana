import { db } from '../src/db/client';
import { reconciliationService } from '../src/modules/transactions/reconciliation.service';
import { AnchorAdapter } from '../src/integrations/anchor/adapter';
import { AnchorClient } from '../src/integrations/anchor/client';
import { env } from '../src/env';

async function main(): Promise<void> {
  const adapter = new AnchorAdapter({
    db,
    client: new AnchorClient({ baseUrl: env.ANCHOR_API_BASE_URL, apiKey: env.ANCHOR_API_KEY }),
  });
  const result = await reconciliationService.sweep(db, adapter, new Date());
  // biome-ignore lint/suspicious/noConsoleLog: this is a CLI tool — log is the expected interface
  console.log(JSON.stringify({ kind: 'recon-result', ...result }));
  if (result.unknown > 0) {
    console.warn(`recon: ${result.unknown} txns had unknown remote state — investigate manually`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('recon-runner failed:', e);
    process.exit(1);
  },
);
