import { defineConfig } from '@playwright/test';

// The extension's service worker fetches Vinted's image servers (repost photos): route it like the pages.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // Each test runs its own browser with its own profile: several at a time (PW_WORKERS=1 to debug).
  workers: Number(process.env.PW_WORKERS ?? 3),
  // Tests of one file are independent too (a browser each): spread them, not just the files.
  fullyParallel: true,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
