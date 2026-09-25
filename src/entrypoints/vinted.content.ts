import { isAllowedApi, isAllowedWrite, type ApiResult, type EraMessage, type PageResult, type ReserveResult } from '@/data/adapters/vinted/protocol';
import { parseItemJsonLd } from '@/data/adapters/vinted/parse';
import { editPriceOnPage } from '@/data/adapters/vinted/edit-form';

/**
 * Runs on vinted.fr pages. Two jobs, both read-only:
 *  - read the item currently open (JSON-LD already in the page: zero network calls);
 *  - perform whitelisted GET calls same-origin, each one reserved against the session budget.
 * It never posts, reposts, likes, follows or messages.
 */
export default defineContentScript({
  matches: ['https://www.vinted.fr/*'],
  // document_end: ready as soon as the DOM is parsed, without waiting for Vinted's heavy scripts.
  runAt: 'document_end',
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
      if (msg.type === 'era:observe') {
        // Read-only: which API URLs has this page itself requested? (Resource Timing — the page is not modified.)
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin) && u.includes('/api/'))
          .map((u) => u.slice(location.origin.length));
        sendResponse({ urls: [...new Set(urls)].slice(-60) });
        return;
      }
      if (msg.type === 'era:edit:form') {
        // Only on the listing edit page, only when ERA's background asked for it (one user click = one edit).
        if (!/\/items\/\d+\/edit/.test(location.pathname)) {
          sendResponse({ ok: false, detail: `pas sur une page de modification (${location.pathname})` });
          return;
        }
        void editPriceOnPage(msg.cents).then(sendResponse);
        return true;
      }
      if (msg.type === 'era:api') {
        void callApi(msg.path).then(sendResponse);
        return true;
      }
      if (msg.type === 'era:write') {
        // Only from ERA's background, only whitelisted routes of an automation the seller switched on.
        void callApi(msg.path, msg.method, msg.body).then(sendResponse);
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

async function callApi(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<ApiResult> {
  const allowed = method === 'GET' ? isAllowedApi(path) : isAllowedWrite(method, path);
  if (!allowed) return { ok: false, code: 'NOT_IMPLEMENTED', detail: `chemin refusé : ${method} ${path.split('?')[0]}` };
  const r = (await browser.runtime.sendMessage({ type: 'era:budget:reserve' } satisfies EraMessage)) as ReserveResult;
  if (!r.ok) return r;
  if (r.wait > 0) await new Promise((res) => setTimeout(res, r.wait));
  try {
    // The headers Vinted's own web app sends with its API calls: CSRF token and anonymous id read from
    // this very page, XHR marker, locale. GET only, same origin; ERA holds no token or cookie of its own.
    const res =
      method === 'GET'
        ? await fetch(path, { credentials: 'same-origin', headers: apiHeaders() })
        : await fetch(path, { method, credentials: 'same-origin', headers: { ...apiHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    await browser.runtime.sendMessage({ type: 'era:budget:report', status: res.status } satisfies EraMessage);
    const where = `HTTP ${res.status} · ${method === 'GET' ? '' : `${method} `}${path.split('?')[0]}`;
    if (res.status === 403) return { ok: false, code: 'NETWORK_403', status: 403, detail: where };
    if (res.status === 429) return { ok: false, code: 'RATE_LIMITED', status: 429, detail: where };
    if (res.status === 401) return { ok: false, code: 'NOT_LOGGED_IN', status: 401, detail: where };
    if (!res.ok) return { ok: false, code: 'UNAVAILABLE', status: res.status, detail: where };
    try {
      // A write may answer 204 / an empty body: that is a success, not "non JSON".
      const text = await res.text();
      return { ok: true, json: text ? JSON.parse(text) : {} };
    } catch {
      // HTML instead of JSON: usually a login page or an anti-bot interstitial.
      return { ok: false, code: 'UNAVAILABLE', status: res.status, detail: `${where} · réponse non JSON` };
    }
  } catch (e) {
    return { ok: false, code: 'UNAVAILABLE', detail: `fetch ${path.split('?')[0]} · ${e instanceof Error ? e.message : 'network'}` };
  }
}

let csrf: string | null | undefined;

/** The CSRF token Vinted put in this page (meta tag, or its inline app config). Read once per page. */
function pageCsrfToken(): string | null {
  if (csrf !== undefined) return csrf;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
  if (meta) return (csrf = meta);
  for (const s of document.querySelectorAll('script:not([src])')) {
    const m = /CSRF_TOKEN[\\"']*\s*:\s*[\\"']*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(s.textContent ?? '');
    if (m) return (csrf = m[1]!);
  }
  return (csrf = null);
}

function cookie(name: string): string | null {
  const m = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : null;
}

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json, text/plain, */*', 'x-requested-with': 'XMLHttpRequest', locale: 'fr-FR', 'accept-language': 'fr' };
  const token = pageCsrfToken();
  if (token) h['x-csrf-token'] = token;
  const anon = cookie('anon_id');
  if (anon) h['x-anon-id'] = anon;
  return h;
}
