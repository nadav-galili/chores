import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    fileParallelism: false,
    // Every test drives real HTTP against a real Postgres; a sync that applies ops and recomputes
    // a child's ledger is several round trips inside one transaction.
    testTimeout: 20_000,
  },
});
