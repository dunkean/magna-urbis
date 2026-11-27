import { defineWorkspace } from 'vitest/config';

// Run npm run test:timing alone, after the fast and slow workers have exited.
export default defineWorkspace([
  { extends: './vitest.config.ts', test: { name: 'timing', include: ['tests/timing/**/*.test.ts'], fileParallelism: false } },
]);
