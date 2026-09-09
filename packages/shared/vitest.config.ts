import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The ledger property tests replay hundreds of random histories; they run for several
    // seconds on a busy machine and were flaking against the 5s default.
    testTimeout: 30_000,
  },
});
