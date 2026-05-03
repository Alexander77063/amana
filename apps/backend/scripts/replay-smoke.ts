import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReplay } from '../src/modules/rules/replay/runner';

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = resolve(__filename, '..');
  const corpusPath = resolve(__dirname, '..', 'test-corpus', 'rule-engine', 'seed.ndjson');

  const result = await runReplay(corpusPath);
  console.info(`matched=${result.matched} mismatched=${result.mismatched.length}`);
  if (result.mismatched.length > 0) {
    console.error(JSON.stringify(result.mismatched, null, 2));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
