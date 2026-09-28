import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// `npm run perf`: timings of the engines on a large synthetic account (tests/bench). Not part of `npm test`.
export default defineConfig({
  plugins: [WxtVitest()],
  test: { globals: true, include: ['tests/bench/**/*.perf.ts'], environment: 'node', setupFiles: ['fake-indexeddb/auto'], testTimeout: 300_000, disableConsoleIntercept: true },
});
