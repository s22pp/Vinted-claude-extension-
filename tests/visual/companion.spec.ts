import type { Page } from '@playwright/test';
import { loadDemo, test } from '../e2e/fixtures';

const OUT = process.env.SHOTS ?? '.output/screens';
const WIDTHS = (process.env.WIDTHS ?? '320,360,420,500').split(',').map(Number);
const THEMES = (process.env.THEMES ?? 'dark,light').split(',') as ('dark' | 'light')[];

/** What sticks out sideways (outermost offender only, scroll containers excepted). */
async function overflow(p: Page) {
  return p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      const pr = el.parentElement?.getBoundingClientRect();
      if (pr && pr.right > vw + 1) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') {
          clipped = true;
          break;
        }
      }
      if (!clipped) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)}`);
    }
    return { scroll: document.documentElement.scrollWidth, vw, out: out.slice(0, 8) };
  });
}

// Toolbar popup and side panel, empty then with demo data: pictures to look at, plus what overflows sideways.
test('companion: popup and side panel', async ({ context, base, extId }) => {
  test.setTimeout(600_000);
  const shoot = async (state: string) => {
    for (const surface of ['popup', 'sidepanel'] as const) {
      for (const theme of THEMES) {
        for (const w of WIDTHS) {
          if (surface === 'popup' && w > 420) continue; // Chrome caps a popup at 800 × 600; ERA's is narrower.
          const p = await context.newPage();
          await p.setViewportSize({ width: w, height: surface === 'popup' ? 600 : 860 });
          await p.goto(`chrome-extension://${extId}/${surface}.html`);
          // The theme as the app keeps it (its setting, and the copy read at boot), not forced over it: the app would
          // paint its own back.
          await p.evaluate(async (t) => {
            localStorage.setItem('era.theme', t);
            const req = indexedDB.open('era-intelligence');
            const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
            await new Promise((r) => {
              const tx = db.transaction('settings', 'readwrite');
              tx.objectStore('settings').put({ key: 'theme', value: t });
              tx.oncomplete = r;
            });
          }, theme);
          await p.reload();
          await p.locator('#root > *').first().waitFor({ timeout: 15_000 });
          await p.waitForTimeout(900);
          const o = await overflow(p);
          if (o.scroll > o.vw || o.out.length) console.log('OVERFLOW', state, surface, theme, w, JSON.stringify(o));
          await p.screenshot({ path: `${OUT}/companion-${state}-${surface}-${theme}-${w}.png`, fullPage: true });
          await p.close();
        }
      }
    }
  };
  await shoot('empty');
  const page = await context.newPage();
  await loadDemo(page, base);
  await shoot('demo');
});
