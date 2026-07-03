import { afterAll } from 'vitest';
import { closeDb } from '../../src/db/client';
import { closeTestDb } from './test-db';

// Per-file connection teardown. Vitest runs with `isolate: true` (required — many suites use
// `vi.mock`, which relies on per-file module isolation), so the module graph is re-evaluated for
// every test file. That means `src/db/client.ts` and `tests/helpers/test-db.ts` each open a fresh
// postgres-js pool per file. Nothing closed those pools, so old connections only got reclaimed by
// postgres-js's `idle_timeout` — a `setTimeout` that is starved when the event loop is CPU-bound
// (v8 coverage instrumentation on a 2-core CI runner). Starved reaping let per-file pools pile up
// past Postgres `max_connections`, producing the flaky `sorry, too many clients already` in the
// coverage gate.
//
// Closing both pools in an awaited `afterAll` reclaims them deterministically, independent of any
// timer, bounding live connections to a single file's pools (~≤15) at any instant. Registered from
// a setup file, this hook is registered first and therefore runs last (afterAll runs in reverse
// registration order), so it closes the pools after the test file's own `afterAll` hooks.
// `allSettled` keeps a slow/failed close from breaking teardown.
afterAll(async () => {
  await Promise.allSettled([closeDb(), closeTestDb()]);
});
