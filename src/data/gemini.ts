import { apiError, parseGeneration, parseModels, pickModel } from '@/intelligence/gemini-parse';
import type { AiRequest } from '@/intelligence/ai-draft';

/**
 * Google's Gemini API, with the seller's own key. The key lives in this browser only (chrome.storage.local): never in
 * ERA's database, so never in a backup or a CSV, never in a log. It goes to Google in a request header, only on a
 * click of the seller (a draft to write, a key to test): nothing is ever sent by itself.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_STORE = 'eraGemini';

export interface GeminiConfig {
  key: string;
  /** "models/…", chosen from what the key lists. */
  model: string | null;
  models: string[];
  /** Last test that listed the models. */
  testedAt: number | null;
}

export type GeminiFailure = { ok: false; code: 'NO_KEY' | 'KEY_REFUSED' | 'QUOTA' | 'HTTP' | 'NETWORK' | 'BLOCKED' | 'EMPTY'; detail: string };

export async function geminiConfig(): Promise<GeminiConfig | null> {
  const got = (await browser.storage.local.get(GEMINI_STORE)) as { [GEMINI_STORE]?: GeminiConfig };
  const c = got[GEMINI_STORE];
  return c && typeof c.key === 'string' && c.key ? c : null;
}

export async function saveGemini(c: GeminiConfig): Promise<void> {
  await browser.storage.local.set({ [GEMINI_STORE]: c });
}

export async function clearGemini(): Promise<void> {
  await browser.storage.local.remove(GEMINI_STORE);
}

/** "…wYQ": enough to recognise a key, never enough to use it. */
export const keyHint = (key: string) => `…${key.slice(-4)}`;

async function call(key: string, path: string, body?: unknown): Promise<{ ok: true; json: unknown } | GeminiFailure> {
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      // The key in a header, never in the address (addresses end up in logs).
      headers: { 'x-goog-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    return { ok: false, code: 'NETWORK', detail: `Google injoignable : ${e instanceof Error ? e.message : String(e)}` };
  }
  const json = await res.json().catch(() => null);
  if (res.ok) return { ok: true, json };
  const said = apiError(json) ?? `HTTP ${res.status}`;
  if (res.status === 429) return { ok: false, code: 'QUOTA', detail: `quota Gemini atteint : ${said}` };
  if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, code: 'KEY_REFUSED', detail: `clé refusée par Google (HTTP ${res.status}) : ${said}` };
  return { ok: false, code: 'HTTP', detail: `HTTP ${res.status} : ${said}` };
}

/** A key works when Google lists the models it may use to write text. */
export async function testGeminiKey(key: string): Promise<{ ok: true; models: string[]; model: string | null } | GeminiFailure> {
  const r = await call(key.trim(), 'models?pageSize=1000');
  if (!r.ok) return r;
  const models = parseModels(r.json);
  if (!models.length) return { ok: false, code: 'EMPTY', detail: 'Google ne liste aucun modèle d’écriture pour cette clé' };
  return { ok: true, models, model: pickModel(models) };
}

/** One text, from one click. */
export async function geminiWrite(req: AiRequest): Promise<{ ok: true; text: string; truncated: boolean; model: string } | GeminiFailure> {
  const c = await geminiConfig();
  if (!c) return { ok: false, code: 'NO_KEY', detail: 'aucune clé Gemini : Réglages → Rédaction avec Gemini' };
  const model = c.model ?? pickModel(c.models);
  if (!model) return { ok: false, code: 'NO_KEY', detail: 'aucun modèle choisi : testez la clé dans les Réglages' };
  const r = await call(c.key, `${model}:generateContent`, {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: { temperature: 0.3 },
  });
  if (!r.ok) return r;
  const g = parseGeneration(r.json);
  if (!g.ok) return { ok: false, code: g.code, detail: g.detail };
  return { ok: true, text: g.text, truncated: g.truncated, model };
}
