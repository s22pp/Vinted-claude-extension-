/**
 * A cascade of ways to find one element on a page whose markup changes: the most stable first (Vinted's own
 * data-testid), then what accessibility and forms expose (aria-label, placeholder, label text, role), then a
 * position relative to an element found by an earlier way. The first that matches wins, and says which one it was —
 * so a change on Vinted's side shows in the diagnostic instead of failing silently. Read-only: it never changes the
 * page. Structured data (__NEXT_DATA__, JSON-LD, the API's JSON) is always preferred to the DOM when it exists.
 */

export type Strategy =
  | { kind: 'testid'; value: string; partial?: boolean }
  | { kind: 'aria'; value: string | RegExp }
  | { kind: 'placeholder'; value: string | RegExp }
  | { kind: 'label'; value: string | RegExp }
  | { kind: 'css'; value: string }
  | { kind: 'relative'; from: Strategy; select: (anchor: Element) => Element | null };

export interface Found<T extends Element> {
  el: T;
  /** Which way found it, e.g. « testid:item-price ». */
  via: string;
}

const matches = (text: string | null | undefined, v: string | RegExp) => !!text && (typeof v === 'string' ? text.trim().toLowerCase() === v.toLowerCase() : v.test(text));

function one(root: ParentNode, s: Strategy): Element | null {
  switch (s.kind) {
    case 'testid':
      return root.querySelector(s.partial ? `[data-testid*="${CSS.escape(s.value)}"]` : `[data-testid="${CSS.escape(s.value)}"]`);
    case 'aria':
      return [...root.querySelectorAll('[aria-label]')].find((e) => matches(e.getAttribute('aria-label'), s.value)) ?? null;
    case 'placeholder':
      return [...root.querySelectorAll('input[placeholder], textarea[placeholder]')].find((e) => matches(e.getAttribute('placeholder'), s.value)) ?? null;
    case 'label': {
      const label = [...root.querySelectorAll('label')].find((l) => matches(l.textContent, s.value));
      if (!label) return null;
      const id = label.getAttribute('for');
      return (id ? (label.ownerDocument.getElementById(id) ?? null) : null) ?? label.querySelector('input, textarea, select');
    }
    case 'css':
      try {
        return root.querySelector(s.value);
      } catch {
        return null;
      }
    case 'relative': {
      const anchor = one(root, s.from);
      return anchor ? s.select(anchor) : null;
    }
  }
}

export function describeStrategy(s: Strategy): string {
  if (s.kind === 'relative') return `relative(${describeStrategy(s.from)})`;
  return `${s.kind}:${typeof s.value === 'string' ? s.value : s.value.source}`;
}

export function querySelectorResilient<T extends Element = HTMLElement>(root: ParentNode, strategies: readonly Strategy[]): Found<T> | null {
  for (const s of strategies) {
    const el = one(root, s);
    if (el) return { el: el as T, via: describeStrategy(s) };
  }
  return null;
}
