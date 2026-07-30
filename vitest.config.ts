import { defineConfig } from 'vitest/config';

// Minimal config for the backend describe/it-style test suites
// (test/integration.test.ts, test/core/system-tests.test.ts) that were
// never wired to any runner. Deliberately does NOT reuse vite.config.ts —
// these are plain Node/TS backend tests with no need for the
// TanStack Start / React / Tailwind plugins there, and pulling those in
// would drag SSR/prerender concerns into a backend unit-test run.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
