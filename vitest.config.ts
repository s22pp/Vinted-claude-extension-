import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
