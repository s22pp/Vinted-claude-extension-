import { parseHTML } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { querySelectorResilient } from '@/lib/dom-resilient';

beforeAll(() => {
  // CSS.escape for the node environment (the browser has it).
  const g = globalThis as { CSS?: { escape: (s: string) => string } };
  g.CSS ??= { escape: (s: string) => s.replace(/["\\\\]/g, '\\\\$&') };
});

// Test data only: markup written the way a page could change it, not copied from Vinted.
const page = (body: string) => parseHTML(`<html><body>${body}</body></html>`).document;

const strategies = [
  { kind: 'testid', value: 'item-price' },
  { kind: 'aria', value: /^prix/i },
  { kind: 'placeholder', value: 'Prix' },
  { kind: 'relative', from: { kind: 'css', value: 'h1' }, select: (a: Element) => a.nextElementSibling },
] as const;

describe('querySelectorResilient', () => {
  it('the most stable way first, and says which one found it', () => {
    const d = page('<div data-testid="item-price">12 €</div><span aria-label="Prix">13 €</span>');
    expect(querySelectorResilient(d, strategies)).toMatchObject({ via: 'testid:item-price' });
  });

  it('falls back down the cascade when the markup changed', () => {
    expect(querySelectorResilient(page('<span aria-label="Prix de l’article">13 €</span>'), strategies)?.via).toBe('aria:^prix');
    expect(querySelectorResilient(page('<input placeholder="Prix">'), strategies)?.via).toBe('placeholder:Prix');
    const rel = querySelectorResilient(page('<h1>Veste</h1><p>14 €</p>'), strategies);
    expect(rel?.via).toBe('relative(css:h1)');
    expect(rel?.el.textContent).toBe('14 €');
    expect(querySelectorResilient(page('<p>rien</p>'), strategies)).toBeNull();
  });
});
