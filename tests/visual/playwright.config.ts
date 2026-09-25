import { defineConfig } from '@playwright/test';

/** Visual QA: `npm run qa:screens` → full-page screenshots of the key screens (demo data). */
export default defineConfig({ testDir: '.', timeout: 240_000, workers: 1, reporter: [['list']] });
