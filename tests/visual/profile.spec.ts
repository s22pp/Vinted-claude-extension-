import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { loadDemo, test } from '../e2e/fixtures';

// Where the main thread's time goes when a screen opens: a CPU profile of the source-mapped build, self time summed
// by source file and by function. ERA_ANALYZE=1 npx wxt build, then
// ERA_EXT=.output-analyze/chrome-mv3 ROUTE=capital npx playwright test -c tests/visual/playwright.config.ts profile
const ROOT = path.resolve(process.env.ERA_EXT ?? '.output/chrome-mv3');

test('profile a screen opening', async ({ context, base }) => {
  test.setTimeout(180_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.bringToFront();
  const route = process.env.ROUTE ?? 'capital';
  const bySource = new Map<string, number>();
  const byFn = new Map<string, number>();
  const maps = new Map<string, TraceMap | null>();
  const mapFor = (url: string) => {
    if (!maps.has(url)) {
      const file = path.join(ROOT, new URL(url).pathname);
      maps.set(url, existsSync(`${file}.map`) ? new TraceMap(readFileSync(`${file}.map`, 'utf8')) : null);
    }
    return maps.get(url)!;
  };
  let total = 0;
  for (let pass = 0; pass < 3; pass++) {
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.waitForTimeout(800);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    await page.evaluate((h) => (location.hash = h), `#/${route}`);
    await page.waitForTimeout(1200);
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number } }[]; samples: number[]; timeDeltas: number[] } };
    await cdp.detach();
    const node = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const us = profile.timeDeltas[i] ?? 0;
      const cf = node.get(id)!.callFrame;
      if (!cf.url.startsWith('chrome-extension://')) {
        const k = cf.functionName || cf.url || '(idle/native)';
        if (k === '(idle)' || k === '(program)') return;
        bySource.set(`[${k}]`, (bySource.get(`[${k}]`) ?? 0) + us);
        total += us;
        return;
      }
      const m = mapFor(cf.url);
      const pos = m ? originalPositionFor(m, { line: cf.lineNumber + 1, column: cf.columnNumber }) : null;
      const src = pos?.source ? pos.source.replace(/^(\.\.\/)+/, '').replace(/^.*node_modules\//, 'npm:') : cf.url;
      const fn = `${pos?.name ?? cf.functionName ?? '?'} (${src}:${pos?.line ?? '?'})`;
      bySource.set(src, (bySource.get(src) ?? 0) + us);
      byFn.set(fn, (byFn.get(fn) ?? 0) + us);
      total += us;
    });
  }
  const ms = (us: number) => (us / 1000 / 3).toFixed(1);
  console.log(`${route}: ${ms(total)} ms of script per opening (mean of 3)`);
  for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${ms(v).padStart(6)} ms  ${k}`);
  console.log('functions:');
  for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 16)) console.log(`  ${ms(v).padStart(6)} ms  ${k}`);
});
