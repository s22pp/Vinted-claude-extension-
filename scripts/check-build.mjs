#!/usr/bin/env node
/**
 * Audit of the built extension before it is loaded in chrome://extensions (npm run check:build, after npm run build):
 * the manifest is MV3 and carries this version, the icons 16/32/48/128 exist at their size, the CSP allows no eval and
 * no remote script, every file the manifest names exists, no page loads a script from the network, and what the
 * dashboard loads at first stays light. Exits 1 on any error; warnings are printed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2] ?? '.output/chrome-mv3';
const errors = [];
const warnings = [];
const ok = [];

if (!existsSync(join(dir, 'manifest.json'))) {
  console.error(`✗ ${dir}/manifest.json introuvable : lancez d'abord npm run build.`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// 1. Manifest V3, this version.
if (m.manifest_version !== 3) errors.push(`manifest_version = ${m.manifest_version} (attendu 3)`);
else ok.push('Manifest V3');
if (m.version !== pkg.version) errors.push(`version du manifeste ${m.version} ≠ package.json ${pkg.version}`);
else ok.push(`version ${m.version}`);

// 2. Icons: the four sizes, real PNG files at their size.
const pngSize = (file) => {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
for (const size of [16, 32, 48, 128]) {
  const rel = m.icons?.[size];
  if (!rel) {
    errors.push(`icône ${size}px absente du manifeste`);
    continue;
  }
  const file = join(dir, rel);
  if (!existsSync(file)) {
    errors.push(`icône ${size}px : fichier ${rel} introuvable`);
    continue;
  }
  const s = pngSize(file);
  if (!s) errors.push(`icône ${size}px : ${rel} n'est pas un PNG`);
  else if (s.w !== size || s.h !== size) errors.push(`icône ${size}px : ${rel} mesure ${s.w}×${s.h}`);
}
if (!errors.some((e) => e.startsWith('icône'))) ok.push('icônes 16, 32, 48 et 128 px présentes, à la bonne taille');

// 3. CSP: MV3's default (strict) or a stricter one; never eval, never a script from the network.
const csp = m.content_security_policy?.extension_pages ?? null;
if (csp === null) ok.push('CSP : celle de Manifest V3 par défaut (script-src self)');
else {
  const script = (/script-src([^;]*)/.exec(csp)?.[1] ?? '').trim();
  if (/unsafe-eval/.test(csp)) errors.push(`CSP : unsafe-eval autorisé (${csp})`);
  if (/unsafe-inline/.test(script)) errors.push(`CSP : unsafe-inline dans script-src (${csp})`);
  if (/https?:|\*/.test(script)) errors.push(`CSP : script distant autorisé (${csp})`);
  if (!errors.some((e) => e.startsWith('CSP'))) ok.push(`CSP : ${csp}`);
}

// 4. Every file the manifest names.
const named = [m.background?.service_worker, m.action?.default_popup, m.side_panel?.default_path, m.options_page, ...(m.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])])].filter(Boolean);
const missing = named.filter((f) => !existsSync(join(dir, f)));
if (missing.length) errors.push(`fichiers du manifeste introuvables : ${missing.join(', ')}`);
else ok.push(`${named.length} fichiers du manifeste présents`);

// 5. No page loads a script from the network (the CSP would refuse it: a blank screen).
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(dir);
const remote = files.filter((f) => f.endsWith('.html') && /<script[^>]+src=["']https?:/i.test(readFileSync(f, 'utf8')));
if (remote.length) errors.push(`script distant dans ${remote.map((f) => relative(dir, f)).join(', ')}`);
else ok.push('aucun script distant dans les pages');

// 6. The dashboard's first load: its own scripts and the modules they preload.
const dash = join(dir, 'dashboard.html');
if (existsSync(dash)) {
  const html = readFileSync(dash, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)=["']\/?([^"']+\.(?:js|css))["']/g)].map((x) => x[1]);
  const bytes = refs.reduce((a, r) => a + (existsSync(join(dir, r)) ? statSync(join(dir, r)).size : 0), 0);
  const kb = Math.round(bytes / 1024);
  if (kb > 900) warnings.push(`chargement initial du tableau de bord : ${kb} Ko (au-delà de 900 Ko)`);
  else ok.push(`chargement initial du tableau de bord : ${kb} Ko (${refs.length} fichiers ; les écrans, la 3D et le studio photo se chargent à la demande)`);
}
const total = Math.round(files.reduce((a, f) => a + statSync(f).size, 0) / 1024);
ok.push(`taille totale : ${total} Ko, ${files.length} fichiers`);

for (const line of ok) console.log(`✓ ${line}`);
for (const line of warnings) console.log(`! ${line}`);
for (const line of errors) console.error(`✗ ${line}`);
console.log(errors.length ? `\n${errors.length} erreur(s) : ne pas charger ce build.` : `\nPrêt à charger : chrome://extensions → Mode développeur → « Charger l'extension non empaquetée » → ${dir}`);
process.exit(errors.length ? 1 : 0);
