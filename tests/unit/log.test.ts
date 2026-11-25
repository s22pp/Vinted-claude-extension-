import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { LOG_KEY, log, readLog } from '@/data/log';

beforeEach(() => fakeBrowser.reset());

describe('structured log', () => {
  it('newest first, each line with its level and place; the last 200 kept; anything malformed ignored', async () => {
    await log('info', 'import', 'stock lu', 1);
    await log('warn', 'budget', 'HTTP 429 : pause', 2);
    expect(await readLog()).toEqual([
      { at: 2, level: 'warn', where: 'budget', message: 'HTTP 429 : pause' },
      { at: 1, level: 'info', where: 'import', message: 'stock lu' },
    ]);
    await Promise.all(Array.from({ length: 210 }, (_, i) => log('info', 'x', String(i), 10 + i)));
    expect(await readLog()).toHaveLength(200);
    await fakeBrowser.storage.local.set({ [LOG_KEY]: [{ at: 'x' }, { at: 1, level: 'info', where: 'a', message: 'ok' }] });
    expect(await readLog()).toEqual([{ at: 1, level: 'info', where: 'a', message: 'ok' }]);
  });
});
