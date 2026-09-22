import { defineConfig } from 'vitest/config';

// DB-backed suites opt in via TEST_DATABASE_URL (CI or local: postgres against
// a disposable database, e.g. postgresql://postgres:postgres@127.0.0.1:5433/workpulse_test).
// When unset, the pure unit suites still run and the integration suites skip.
const testUrl = process.env.TEST_DATABASE_URL || '';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './test/globalSetup.js',
    fileParallelism: false,
    env: testUrl
      ? {
          DATABASE_URL: testUrl,
          DEMO_TODAY_YMD: '2026-09-21',
          WORKPULSE_TEST: '1',
        }
      : {},
  },
});