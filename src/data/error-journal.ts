/**
 * The last errors of ERA itself (a screen that failed to display, an operation of the service worker that threw),
 * kept in this browser only — never sent — for the diagnostic report the seller can copy.
 */
export const ERROR_JOURNAL_KEY = 'eraUiErrors';
const KEEP = 20;

export interface JournalError {
  at: number;
  where: string;
  message: string;
  stack: string;
}

export async function recordError(where: string, error: unknown, extra = ''): Promise<void> {
  const e = error instanceof Error ? error : new Error(String(error));
  const row: JournalError = { at: Date.now(), where, message: e.message.slice(0, 300), stack: `${e.stack ?? ''}\n${extra}`.trim().slice(0, 1200) };
  try {
    const got = (await browser.storage.local.get(ERROR_JOURNAL_KEY)) as { [ERROR_JOURNAL_KEY]?: JournalError[] };
    await browser.storage.local.set({ [ERROR_JOURNAL_KEY]: [row, ...(got[ERROR_JOURNAL_KEY] ?? [])].slice(0, KEEP) });
  } catch {
    /* storage unavailable: nothing more can be done */
  }
}

export async function readErrors(): Promise<JournalError[]> {
  try {
    const got = (await browser.storage.local.get(ERROR_JOURNAL_KEY)) as { [ERROR_JOURNAL_KEY]?: JournalError[] };
    return got[ERROR_JOURNAL_KEY] ?? [];
  } catch {
    return [];
  }
}
