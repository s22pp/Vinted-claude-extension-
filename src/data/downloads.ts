export type Saved = { ok: true; file: string } | { ok: false; detail: string };

/** Download one file into the browser's downloads folder and wait (≤ 20 s) to know whether it was saved. */
export async function saveFile(url: string, filename: string, timeoutMs = 20_000, conflictAction: 'uniquify' | 'overwrite' = 'uniquify'): Promise<Saved> {
  let id: number;
  try {
    id = await browser.downloads.download({ url, filename, conflictAction, saveAs: false });
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  return new Promise<Saved>((resolve) => {
    let over = false;
    const finish = (r: Saved) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      browser.downloads.onChanged.removeListener(onChanged);
      resolve(r);
    };
    const check = async () => {
      const [d] = await browser.downloads.search({ id });
      if (d?.state === 'complete') finish({ ok: true, file: d.filename.split(/[\\/]/).slice(-2).join('/') });
      else if (d?.state === 'interrupted') finish({ ok: false, detail: `téléchargement interrompu (${d.error ?? 'inconnu'})` });
    };
    const onChanged = (delta: { id: number; state?: unknown }) => {
      if (delta.id === id && delta.state) void check();
    };
    browser.downloads.onChanged.addListener(onChanged);
    const timer = setTimeout(() => finish({ ok: false, detail: 'toujours en cours de téléchargement' }), timeoutMs);
    void check();
  });
}
