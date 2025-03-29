import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        includeSource: ['src/**/*.ts'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
        },
    },
});