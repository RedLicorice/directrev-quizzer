import { defineConfig } from 'vitest/config';

// Unit + build tests (`npm test`). Kept apart from vite.config.ts so the PWA plugin is not loaded.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 240_000,
  },
});
