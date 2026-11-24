import type { EraMessage } from './protocol';

/** Small helpers on a vinted.fr tab, shared by the adapter and the search-page visits. */

/**
 * Chrome's « no page to receive it » error: the message never reached ERA's script in the tab (the page was reloading,
 * a heavy page still starting). Anything else (the answer lost on the way back) may mean the page did act on it.
 */
export const neverArrived = (e: unknown): boolean => /Receiving end does not exist|Could not establish connection/i.test(e instanceof Error ? e.message : String(e));

/**
 * When a message to the Vinted tab may be sent once more: a read always (sending it again changes nothing on the
 * account); a write only when it provably never arrived — else it may have been taken, and is never sent twice.
 */
export const mayResend = (e: unknown, kind: 'read' | 'write'): boolean => kind === 'read' || neverArrived(e);

export async function ping(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'era:ping' } satisfies EraMessage);
    return true;
  } catch {
    return false;
  }
}

/** ERA's content script answers in this tab within `ms` (a page still starting is given that long). */
export async function answersWithin(tabId: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await ping(tabId)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function waitForLoad(tabId: number, timeoutMs = 25_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(on);
      resolve();
    };
    const on = (id: number, info: { status?: string }) => id === tabId && info.status === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    browser.tabs.onUpdated.addListener(on);
    void browser.tabs.get(tabId).then((t) => t.status === 'complete' && done());
  });
}
