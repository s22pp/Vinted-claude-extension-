/** Median and best of `runs` timed calls (after `warm` untimed ones), in ms. */
export function time(label: string, fn: () => void, runs = 15, warm = 3): { median: number; best: number } {
  for (let i = 0; i < warm; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  const r = { median: t[Math.floor(t.length / 2)]!, best: t[0]! };
  console.log(`${label.padEnd(58)} median ${r.median.toFixed(1).padStart(7)} ms · best ${r.best.toFixed(1).padStart(7)} ms`);
  return r;
}
