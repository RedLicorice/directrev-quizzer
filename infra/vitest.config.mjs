import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['edge/test/**/*.test.mjs', 'lambda/auth/test/**/*.test.ts', 'scripts/test/**/*.test.mjs'],
    environment: 'node',
  },
});
