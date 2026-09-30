/**
 * Reading Google's Gemini API answers (generativelanguage.googleapis.com, v1beta), pure. Fields as the API documents
 * them: `models[].name` / `supportedGenerationMethods`, `candidates[].content.parts[].text`, `promptFeedback`.
 */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** Models this key can use to write text ("models/…" names), in the API's order. */
export function parseModels(json: unknown): string[] {
  return arr(obj(json).models)
    .map(obj)
    .filter((m) => typeof m.name === 'string' && arr(m.supportedGenerationMethods).includes('generateContent'))
    .map((m) => m.name as string);
}

/** Not for writing a short French text (images, speech, embeddings, live audio, experiments). */
const NOT_TEXT = /image|tts|audio|live|embed|aqa|vision|veo|imagen|learnlm|gemma|robotics|computer-use|exp/i;

/**
 * The model ERA uses unless the seller picks another: a stable "flash" (fast, cheap) of the newest version the key
 * lists, else the newest stable text model, else the first listed. Chosen from what the key lists, never a name
 * written in advance (models are renamed and retired).
 */
export function pickModel(models: readonly string[]): string | null {
  const text = models.filter((m) => !NOT_TEXT.test(m));
  const stable = text.filter((m) => !/preview/i.test(m));
  const version = (m: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(m)?.[1] ?? 0);
  const newest = (xs: string[]) => [...xs].sort((a, b) => version(b) - version(a) || a.length - b.length)[0] ?? null;
  return newest(stable.filter((m) => /flash/i.test(m) && !/lite/i.test(m))) ?? newest(stable) ?? newest(text) ?? models[0] ?? null;
}

export type GenerationResult = { ok: true; text: string; truncated: boolean } | { ok: false; code: 'BLOCKED' | 'EMPTY'; detail: string };

/** The text of the first answer; a blocked or empty answer said as such, never an empty text taken for a draft. */
export function parseGeneration(json: unknown): GenerationResult {
  const j = obj(json);
  const blocked = obj(j.promptFeedback).blockReason;
  if (typeof blocked === 'string') return { ok: false, code: 'BLOCKED', detail: `demande refusée par Gemini (${blocked})` };
  const cand = obj(arr(j.candidates)[0]);
  const text = arr(obj(cand.content).parts)
    .map(obj)
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('')
    .trim();
  const finish = typeof cand.finishReason === 'string' ? cand.finishReason : null;
  if (!text) return { ok: false, code: finish === 'SAFETY' ? 'BLOCKED' : 'EMPTY', detail: finish ? `réponse vide (${finish})` : 'réponse vide' };
  return { ok: true, text, truncated: finish === 'MAX_TOKENS' };
}

/** Google's own error message, when it gave one. */
export function apiError(json: unknown): string | null {
  const m = obj(obj(json).error).message;
  return typeof m === 'string' ? m : null;
}
