import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // Pin react to the SAME hoisted copy react-test-renderer (external CJS)
      // resolves, so there is a single react evaluation / hooks dispatcher.
      'react/jsx-dev-runtime': at('../../node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': at('../../node_modules/react/jsx-runtime.js'),
      react: at('../../node_modules/react/index.js'),
      // Reuse the shared RN/native mocks from @amana/ui's test harness.
      'react-native': at('../../packages/ui/test/react-native.mock.tsx'),
      'react-native-safe-area-context': at('../../packages/ui/test/safe-area.mock.tsx'),
      'react-native-svg': at('../../packages/ui/test/svg.mock.tsx'),
      '@react-navigation/native': at('./test/mocks/react-navigation-native.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    globals: false,
    // Inline react-hook-form so its `react` import goes through the alias above
    // and shares the single react instance (it uses hooks internally).
    server: { deps: { inline: [/react-hook-form/, /@hookform/] } },
  },
});
