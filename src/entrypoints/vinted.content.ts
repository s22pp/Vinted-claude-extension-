import { ALLOWED_API, type ApiResult, type EraMessage, type PageResult, type ReserveResult } from '@/data/adapters/vinted/protocol';
import { parseItemJsonLd } from '@/data/adapters/vinted/parse';

/**
 * Runs on vinted.fr pages. Two jobs, both read-only:
 *  - read the item currently open (JSON-LD already in the page: zero network calls);
 *  - perform whitelisted GET calls same-origin, each one reserved against the session budget.
 * It never posts, reposts, likes, follows or messages.
 */
export default defineContentScript({
  matches: ['https://www.vinted.fr/*'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((msg: EraMessage, _sender, sendResponse) => {
      if (msg.type === 'era:ping') {
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'era:page') {
        sendResponse(readPage());
        return;
      }
      if (msg.type === 'era:api') {
        void callApi(msg.path).then(sendResponse);
        return true;
      }
    });
  },
});

function readPage(): PageResult {
  const isItemPage = /\/items\/\d+/.test(location.pathname);
  if (!isItemPage) return { item: null, isItemPage };
  const blocks: unknown[] = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      blocks.push(JSON.parse(s.textContent ?? ''));
    } catch {
      /* malformed block: ignore */
    }
  }
  return { item: parseItemJsonLd(blocks, location.href), isItemPage };
}

async function callApi(path: string): Promise<ApiResult> {
  if (!ALLOWED_API.some((p) => path.startsWith(p))) return { ok: false, code: 'NOT_IMPLEMENTED' };
  const r = (await browser.runtime.sendMessage({ type: 'era:budget:reserve' } satisfies EraMessage)) as ReserveResult;
  if (!r.ok) return r;
  if (r.wait > 0) await new Promise((res) => setTimeout(res, r.wait));
  try {
    const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    await browser.runtime.sendMessage({ type: 'era:budget:report', status: res.status } satisfies EraMessage);
    const where = `HTTP ${res.status} · ${path.split('?')[0]}`;
    if (res.status === 403) return { ok: false, code: 'NETWORK_403', status: 403, detail: where };
    if (res.status === 429) return { ok: false, code: 'RATE_LIMITED', status: 429, detail: where };
    if (res.status === 401) return { ok: false, code: 'NOT_LOGGED_IN', status: 401, detail: where };
    if (!res.ok) return { ok: false, code: 'UNAVAILABLE', status: res.status, detail: where };
    try {
      return { ok: true, json: await res.json() };
    } catch {
      // HTML instead of JSON: usually a login page or an anti-bot interstitial.
      return { ok: false, code: 'UNAVAILABLE', status: res.status, detail: `${where} · réponse non JSON` };
    }
  } catch (e) {
    return { ok: false, code: 'UNAVAILABLE', detail: `fetch ${path.split('?')[0]} · ${e instanceof Error ? e.message : 'network'}` };
  }
}
