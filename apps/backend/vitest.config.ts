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
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      // Honest denominator: measure all source, including files with no test,
      // then exclude only what genuinely cannot be unit-tested.
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // HTTP server bootstrap (binds a port)
        'src/db/migrations/**', // generated SQL journal
        'src/db/schema/**', // drizzle table declarations (types)
        'src/**/*.d.ts',
        'bin/**',
      ],
      // Anti-regression gate. Set just below current measured coverage so the
      // suite fails if coverage drops, without being aspirational. Backend-only
      // (this config) — never a repo-wide threshold dragged down by mobile.
      // Measured 2026-06: lines/statements 93.9%, functions 91.9%, branches 81.3%.
      // Gate sits ~1-2% below each so normal variance passes but a real drop fails.
      thresholds: {
        lines: 92,
        statements: 92,
        functions: 90,
        branches: 80,
      },
    },
  },
});
