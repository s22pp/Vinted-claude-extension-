// Bytes per source module in each built chunk, from the source maps of an `ERA_ANALYZE=1 wxt build`.
// Usage: npm run analyze  (prints the heaviest chunks and, in each, the heaviest modules)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TraceMap, eachMapping } from '@jridgewell/trace-mapping';

const root = '.output-analyze/chrome-mv3';
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
walk(root);

const group = (src) => {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(src);
  return m ? `npm:${m[1]}` : src.replace(/^(\.\.\/)+/, '');
};

const rows = [];
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  let map;
  try {
    map = new TraceMap(readFileSync(`${f}.map`, 'utf8'));
  } catch {
    continue;
  }
  const lines = code.split('\n');
  const bytes = new Map();
  let prev = null;
  eachMapping(map, (m) => {
    if (prev && prev.generatedLine === m.generatedLine) {
      const n = m.generatedColumn - prev.generatedColumn;
      const k = prev.source ? group(prev.source) : '(none)';
      bytes.set(k, (bytes.get(k) ?? 0) + n);
    } else if (prev) {
      const n = (lines[prev.generatedLine - 1]?.length ?? 0) - prev.generatedColumn;
      const k = prev.source ? group(prev.source) : '(none)';
      bytes.set(k, (bytes.get(k) ?? 0) + n);
    }
    prev = m;
  });
  rows.push({ file: relative(root, f), size: code.length, bytes });
}
rows.sort((a, b) => b.size - a.size);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const r of rows.slice(0, Number(process.env.TOP_CHUNKS ?? 6))) {
  console.log(`\n${r.file} — ${kb(r.size)}`);
  for (const [k, n] of [...r.bytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP_MODULES ?? 15))) console.log(`  ${kb(n).padStart(9)}  ${k}`);
}
