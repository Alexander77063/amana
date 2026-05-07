import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    globalSetup: ['tests/helpers/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // truncateAll under accumulated DB load can take >10s; bump hook timeout
    // to remove flaky-beforeEach noise without masking real failures.
    hookTimeout: 30000,
  },
});
