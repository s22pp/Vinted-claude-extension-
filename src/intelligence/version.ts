/** "0.37.0" newer than "0.36.2": numbers compared part by part; anything unreadable is never newer. */
export function isNewer(candidate: string | null | undefined, running: string): boolean {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);
  const a = candidate ? parse(candidate.trim()) : null;
  const b = parse(running.trim());
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
