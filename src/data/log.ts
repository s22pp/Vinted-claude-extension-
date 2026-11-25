/**
 * ERA's structured log: what the extension did by itself and why, as short lines with a level — kept in this browser
 * only (storage.local, the last 200), never sent, shown in Réglages → Diagnostic and in the copied report. It replaces
 * any console output: production code writes nothing to the console.
 */
export const LOG_KEY = 'eraLog';
const KEEP = 200;

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  at: number;
  level: LogLevel;
  /** Where it happened: « import », « budget », « repost », « backup », « profil »… */
  where: string;
  message: string;
}

const isLine = (x: unknown): x is LogLine =>
  typeof x === 'object' && x !== null && typeof (x as LogLine).at === 'number' && ['info', 'warn', 'error'].includes((x as LogLine).level) && typeof (x as LogLine).where === 'string' && typeof (x as LogLine).message === 'string';

// One write at a time: lines logged together are all kept, in order.
let chain: Promise<void> = Promise.resolve();

export function log(level: LogLevel, where: string, message: string, now = Date.now()): Promise<void> {
  const line: LogLine = { at: now, level, where: where.slice(0, 40), message: message.slice(0, 400) };
  chain = chain
    .then(async () => {
      const got = (await browser.storage.local.get(LOG_KEY))[LOG_KEY];
      const list = Array.isArray(got) ? got.filter(isLine) : [];
      await browser.storage.local.set({ [LOG_KEY]: [line, ...list].slice(0, KEEP) });
    })
    .catch(() => undefined);
  return chain;
}

export async function readLog(): Promise<LogLine[]> {
  try {
    const got = (await browser.storage.local.get(LOG_KEY))[LOG_KEY];
    return Array.isArray(got) ? got.filter(isLine) : [];
  } catch {
    return [];
  }
}
