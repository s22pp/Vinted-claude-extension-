import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures';

// ERA loaded from its own copy of the folder, as the seller's updater keeps it: the test changes that copy only.
const folder = mkdtempSync(path.join(tmpdir(), 'era-folder-'));
cpSync(path.resolve(process.env.ERA_EXT ?? '.output/chrome-mv3'), folder, { recursive: true });
test.use({ extPath: folder });

test('update without a ZIP: a newer version put in ERA’s folder is offered in one click; by itself only when chosen', async ({ context, base }) => {
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  const card = page.getByTestId('update-card');
  await expect(card).toContainText('chargée depuis un dossier : à jour');
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
  // The updater puts a newer version in the folder (here, the manifest's version).
  const mf = path.join(folder, 'manifest.json');
  const running = (JSON.parse(readFileSync(mf, 'utf8')) as { version: string }).version;
  writeFileSync(mf, readFileSync(mf, 'utf8').replace(/"version":"[^"]+"/, '"version":"99.0.0"'));
  await page.reload();
  await expect(page.getByTestId('update-banner')).toContainText(`Nouvelle version d’ERA prête : 99.0.0 (vous avez la ${running})`);
  await expect(card).toContainText(`Version ${running} en marche · la 99.0.0 est prête dans le dossier d’ERA.`);
  await expect(card.getByRole('button', { name: 'Mettre à jour ERA' })).toBeVisible();
  // Off by default: a notification and a click; the seller's choice is kept.
  const auto = page.getByLabel(/Mettre à jour tout seul/);
  await expect(auto).not.toBeChecked();
  await auto.check();
  await expect.poll(() => context.serviceWorkers().at(-1)!.evaluate(async () => (await chrome.storage.local.get('eraAutoUpdate')).eraAutoUpdate)).toBe(true);
});
