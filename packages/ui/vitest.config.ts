import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const mock = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // RN ships Flow-typed source esbuild can't transform — alias to mocks.
      'react-native': mock('./test/react-native.mock.tsx'),
      'react-native-safe-area-context': mock('./test/safe-area.mock.tsx'),
      'react-native-svg': mock('./test/svg.mock.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.tsx', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    globals: false,
  },
});
