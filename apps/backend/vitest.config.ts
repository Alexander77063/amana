import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    globalSetup: ['tests/helpers/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // truncateAll and multi-step integration tests under accumulated DB load
    // can exceed 5s; match testTimeout to hookTimeout.
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
