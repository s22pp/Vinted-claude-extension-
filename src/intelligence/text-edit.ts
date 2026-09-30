/**
 * A change to the title or the description of one listing, as an operation applied to what the field holds on
 * Vinted's own edit page (never to ERA's copy, which can be stale or empty: the wardrobe gives no description).
 * Pure: the content script applies it to the field it found, the background checks Vinted shows the result.
 */

export type TextField = 'title' | 'description';

export type TextOp =
  | { kind: 'set'; text: string }
  | { kind: 'prefix'; text: string }
  | { kind: 'suffix'; text: string }
  /** Every occurrence of `find`, exactly as written (case included), by `text` (empty: removed). */
  | { kind: 'replace'; find: string; text: string };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.replace(/\r\n?/g, '\n').trim();

/** Why an operation is refused before anything is opened (null: it can be sent). */
export function textOpProblem(field: TextField, op: TextOp): string | null {
  if (op.kind === 'replace') {
    if (!op.find.trim()) return 'texte à remplacer vide';
    if (op.find === op.text) return 'remplacement identique';
  } else if (!op.text.trim()) return 'texte vide';
  if (op.text.includes('__')) return 'texte avec des « __ » à remplir';
  if (field === 'title' && /[\r\n]/.test(op.text)) return 'un titre tient sur une ligne';
  return null;
}

/**
 * What the field becomes, or null when nothing would change: the text already there (at the start for a prefix, at
 * the end for a suffix), nothing to replace, or the same text. A title stays on one line, words separated by one
 * space; a description gets its addition as a paragraph of its own.
 */
export function applyTextOp(before: string, op: TextOp, field: TextField): string | null {
  const sep = field === 'title' ? ' ' : '\n\n';
  const clean = field === 'title' ? oneLine : norm;
  const cur = clean(before);
  const add = clean(op.text);
  let after: string;
  switch (op.kind) {
    case 'set':
      after = add;
      break;
    case 'prefix':
      if (cur.toLowerCase().startsWith(add.toLowerCase())) return null;
      after = cur ? `${add}${sep}${cur}` : add;
      break;
    case 'suffix':
      if (cur.toLowerCase().endsWith(add.toLowerCase())) return null;
      after = cur ? `${cur}${sep}${add}` : add;
      break;
    case 'replace':
      if (!before.includes(op.find)) return null;
      after = clean(before.split(op.find).join(op.text));
      break;
  }
  return after === cur ? null : after;
}

/** Vinted shows the text asked for: same words, whatever spaces or line endings it normalised. */
export function sameFieldText(field: TextField, a: string, b: string): boolean {
  return field === 'title' ? oneLine(a) === oneLine(b) : norm(a) === norm(b);
}
