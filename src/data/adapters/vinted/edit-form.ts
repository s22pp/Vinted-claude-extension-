/**
 * Runs inside the vinted.fr edit page (content script). Changes ONLY the price field, then clicks the save
 * button — never the category (changing it resets brand, size, condition, price), never a boost, never delete.
 * Anything ambiguous aborts before saving: nothing is changed on Vinted.
 */
import type { EditFormResult } from './protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function visible(el: HTMLElement): boolean {
  return !!(el.offsetParent || el.getClientRects().length);
}

function labelOf(input: HTMLInputElement): string {
  const byFor = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null;
  return `${byFor ?? ''} ${input.closest('label')?.textContent ?? ''}`;
}

export function findPriceInput(doc: Document = document): HTMLInputElement | { error: string } {
  const all = [...doc.querySelectorAll<HTMLInputElement>('input')].filter((i) => i.type !== 'hidden' && i.type !== 'checkbox' && i.type !== 'radio' && !i.disabled && visible(i));
  const hay = (i: HTMLInputElement) =>
    [i.id, i.name, i.getAttribute('data-testid'), i.getAttribute('aria-label'), i.placeholder, labelOf(i)].join(' ').toLowerCase();
  const candidates = all.filter((i) => /\bprice\b|prix/.test(hay(i)) && !/frais|shipping|port|colis|package|boost/.test(hay(i)));
  if (candidates.length === 1) return candidates[0]!;
  const exact = candidates.filter((i) => i.id === 'price' || i.name === 'price');
  if (exact.length === 1) return exact[0]!;
  return { error: candidates.length === 0 ? 'champ prix introuvable sur la page de modification' : `${candidates.length} champs « prix » possibles : modification annulée` };
}

const SAVE = /(enregistrer|sauvegarder|mettre à jour|valider|modifier l.annonce|save|update)/i;
const FORBIDDEN = /(supprimer|delete|retirer|masquer|réserv|reserv|vendu|boost|promouv|mettre en avant|annuler|cancel)/i;

export function findSaveButton(input: HTMLInputElement): HTMLButtonElement | { error: string } {
  const scope: ParentNode = input.closest('form') ?? document;
  const buttons = [...scope.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled && visible(b));
  const safe = buttons.filter((b) => SAVE.test(b.textContent ?? '') && !FORBIDDEN.test(b.textContent ?? ''));
  if (safe.length === 1) return safe[0]!;
  const submit = safe.filter((b) => b.type === 'submit');
  if (submit.length === 1) return submit[0]!;
  return { error: safe.length === 0 ? 'bouton d’enregistrement introuvable' : 'plusieurs boutons d’enregistrement : modification annulée' };
}

/** The price input inspects event.inputType: a generic Event('input') empties it. insertText is what works. */
function nativeSet(el: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  el.focus();
  setter.call(el, v);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: v }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',');
}

export function readCents(value: string): number | null {
  const n = Number.parseFloat(value.replace(/[^\d,.]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function editPriceOnPage(cents: number): Promise<EditFormResult> {
  let found: ReturnType<typeof findPriceInput> = { error: 'page non chargée' };
  for (let i = 0; i < 30; i++) {
    found = findPriceInput();
    if (!('error' in found)) break;
    await sleep(500);
  }
  if ('error' in found) return { ok: false, detail: found.error };
  const input = found;
  const before = input.value;
  nativeSet(input, formatPrice(cents));
  await sleep(400);
  if (readCents(input.value) !== cents) return { ok: false, detail: `le champ prix affiche « ${input.value} » après saisie : rien n’a été enregistré` };
  const btn = findSaveButton(input);
  if ('error' in btn) return { ok: false, detail: btn.error };
  // Close a fixed promo overlay covering the button, if any, without touching anything else.
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return { ok: true, before };
}
