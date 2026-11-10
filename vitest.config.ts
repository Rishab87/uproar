import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'apps/web/e2e/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database suites share one Postgres. They isolate themselves by schema, so files can run in parallel.
    fileParallelism: true,
  },
});
