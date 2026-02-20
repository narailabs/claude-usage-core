import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      exclude: ['scripts/**', 'vitest.config.ts', 'tsup.config.ts', 'dist/**'],
    },
  },
});
