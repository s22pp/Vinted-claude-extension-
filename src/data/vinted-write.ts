import { MarketplaceError } from './adapters/marketplace';
import { autoWriteWait, recordAutoWrite } from './adapters/vinted/budget-store';
import type { ApiResult, EraMessage } from './adapters/vinted/protocol';
import { ensureVintedTab } from './adapters/vinted/vinted-adapter';

/** Sleep in short steps touching an extension API: the service worker stays awake meanwhile. */
export async function waitAlive(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, Math.min(4000, end - Date.now())));
    await browser.storage.local.get('eraAuto');
  }
}

/**
 * Background-only: one whitelisted write through the vinted.fr tab (the content script refuses anything else).
 * `spaced` writes wait their turn (≥ 12 s apart) and count in the daily quota; a query sent as POST (a
 * category suggestion) is not a write on the account and only goes through the read budget.
 */
export async function vintedWrite(method: 'POST' | 'PUT', path: string, body: unknown, { spaced = true } = {}): Promise<unknown> {
  if (spaced) {
    const wait = await autoWriteWait();
    if (wait > 0) await waitAlive(wait);
  }
  const { tabId } = await ensureVintedTab();
  let res: ApiResult;
  try {
    res = (await browser.tabs.sendMessage(tabId, { type: 'era:write', method, path, body } satisfies EraMessage)) as ApiResult;
  } catch {
    throw new MarketplaceError('NO_VINTED_TAB', 'CONTENT_SCRIPT_UNREACHABLE');
  }
  // Counted even when refused: the quota protects the account, not the success rate.
  if (spaced) await recordAutoWrite();
  if (!res.ok) throw new MarketplaceError(res.code, res.detail ?? res.code);
  return res.json;
}
