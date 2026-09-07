import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // One React instance for the component and react-test-renderer (pnpm otherwise splits it).
      react: root('../../node_modules/react'),
      'react/jsx-runtime': root('../../node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': root('../../node_modules/react/jsx-dev-runtime'),
      'next/navigation': root('./test/next.mock.tsx'),
      'next/link': root('./test/next.mock.tsx'),
    },
  },
  test: {
    environment: 'node',
    // `test/**` is included so the query harness in test/render.tsx has its own test: every screen
    // test selects through it, and a helper that quietly returns the wrong node fails silently.
    include: [
      'lib/**/*.test.ts',
      'components/**/*.test.tsx',
      'app/**/*.test.tsx',
      'test/**/*.test.tsx',
    ],
    setupFiles: ['./test/setup.ts'],
    globals: false,
  },
});
