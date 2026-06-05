import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    singleThread: true,
    include: ['src/**/*.test.ts', 'ui/src/**/*.test.ts'],
    includeSource: ['src/**/*.ts', 'ui/src/**/*.ts', 'ui/src/**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.pnpm/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**', '**/.pnpm/**'],
    },
  },
});
