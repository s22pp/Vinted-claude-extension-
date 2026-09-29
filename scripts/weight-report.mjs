// What each entry point really loads when it opens: the HTML's scripts and stylesheets, then every module they import
// statically (dynamic imports are counted apart: they load later, on demand). Sizes raw and gzip, from the build.
// Usage: node scripts/weight-report.mjs [.output/chrome-mv3]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(process.argv[2] ?? '.output/chrome-mv3');
const read = (rel) => readFileSync(path.join(root, rel));
const gz = (buf) => gzipSync(buf, { level: 9 }).length;

function staticImports(rel) {
  const src = read(rel).toString();
  const out = new Set();
  // import x from "./a.js"; import "./b.js"; export * from "./c.js" — top-level, static only.
  for (const m of src.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[^'"()]*?\s*from\s*)?["']([^"']+\.(?:js|css))["']/g)) {
    out.add(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
  return [...out];
}

function dynamicImports(rel) {
  const src = read(rel).toString();
  return [...src.matchAll(/import\(\s*["']([^"']+\.js)["']\s*\)/g)].map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
}

function closure(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith('.js')) stack.push(...staticImports(f));
  }
  return [...seen];
}

function htmlEntries(html) {
  const src = read(html).toString();
  const js = [...src.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const css = [...src.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const pre = [...src.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  return [...js, ...css, ...pre].map((u) => u.replace(/^\//, ''));
}

function total(files) {
  let raw = 0;
  let zipped = 0;
  for (const f of files) {
    const b = read(f);
    raw += b.length;
    zipped += gz(b);
  }
  return { files: files.length, raw, gzip: zipped };
}

const kb = (n) => `${(n / 1024).toFixed(1)} Ko`;
const rows = [];
for (const html of ['popup.html', 'dashboard.html', 'sidepanel.html']) {
  const files = closure(htmlEntries(html));
  const t = total([html, ...files]);
  const lazy = new Set(files.filter((f) => f.endsWith('.js')).flatMap(dynamicImports));
  rows.push({ entry: html, ...t, lazyChunks: lazy.size });
}
rows.push({ entry: 'background.js (service worker)', ...total(closure(['background.js'])), lazyChunks: 0 });
for (const f of readdirSync(path.join(root, 'content-scripts'))) {
  if (f.endsWith('.js')) rows.push({ entry: `content-scripts/${f}`, ...total([`content-scripts/${f}`]), lazyChunks: 0 });
}
const all = [];
const walk = (d) => {
  for (const f of readdirSync(path.join(root, d))) {
    const rel = path.posix.join(d, f);
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
    else all.push(rel);
  }
};
walk('.');

console.log('Entrée'.padEnd(46), 'fichiers', 'brut'.padStart(10), 'gzip'.padStart(10));
for (const r of rows) console.log(r.entry.padEnd(46), String(r.files).padStart(8), kb(r.raw).padStart(10), kb(r.gzip).padStart(10));
const everything = total(all);
console.log('Extension entière'.padEnd(46), String(everything.files).padStart(8), kb(everything.raw).padStart(10), kb(everything.gzip).padStart(10));
if (process.env.JSON) console.log(JSON.stringify(rows));
