import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: './out/.vitest-cache',
  test: {
    testTimeout: 60000,
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 2,
    // Loads the core WASM package in every test file (see the file).
    setupFiles: ['./tests/setup/coreWasm.ts'],
  },
});
