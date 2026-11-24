// Renders assets/era-mark.svg to the PNG sizes Chrome needs, with headless Chromium.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../assets/era-mark.svg', import.meta.url), 'utf8');
const out = new URL('../public/icon/', import.meta.url);
mkdirSync(out, { recursive: true });
// The bundled browser if this Playwright has one, else the machine's (same fallback as the e2e fixtures).
const exe = process.env.ERA_CHROME ?? (existsSync(chromium.executablePath()) ? undefined : ['/opt/pw-browsers/chromium'].find((p) => existsSync(p)));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.locator('svg').screenshot({ path: new URL(`${size}.png`, out).pathname, omitBackground: true });
}
await browser.close();
console.log('icons written');
