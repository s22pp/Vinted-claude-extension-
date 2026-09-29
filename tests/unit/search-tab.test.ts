import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeIdleSearchTab, SEARCH_TAB_IDLE_MS } from '@/data/adapters/vinted/search-page';

beforeEach(() => fakeBrowser.reset());

const keep = (id: number, at: number) => fakeBrowser.storage.session.set({ eraSearchTab: { id, at } });

describe('ERA search tab: closed once idle, never one the seller took over', () => {
  it('idle long enough, in the background, still on a search page: closed and forgotten', async () => {
    const tab = await fakeBrowser.tabs.create({ url: 'https://www.vinted.fr/catalog?search_text=veste', active: false });
    await keep(tab.id!, 0);
    await closeIdleSearchTab(SEARCH_TAB_IDLE_MS);
    // Real Chrome throws on a closed tab, the fake answers undefined: gone either way.
    expect(await fakeBrowser.tabs.get(tab.id!).catch(() => null)).toBeFalsy();
    expect(await fakeBrowser.storage.session.get('eraSearchTab')).toEqual({});
  });

  it('used a moment ago: kept, checked again later', async () => {
    const tab = await fakeBrowser.tabs.create({ url: 'https://www.vinted.fr/catalog?search_text=veste', active: false });
    await keep(tab.id!, 1_000);
    await closeIdleSearchTab(1_000 + SEARCH_TAB_IDLE_MS - 1);
    expect((await fakeBrowser.tabs.get(tab.id!)).id).toBe(tab.id);
    expect(await fakeBrowser.alarms.get('era-search-tab')).toBeTruthy();
  });

  it('the seller opened a listing in it, or is looking at it: left alone', async () => {
    const moved = await fakeBrowser.tabs.create({ url: 'https://www.vinted.fr/items/42-veste', active: false });
    await keep(moved.id!, 0);
    await closeIdleSearchTab(SEARCH_TAB_IDLE_MS);
    expect((await fakeBrowser.tabs.get(moved.id!)).id).toBe(moved.id);
    const shown = await fakeBrowser.tabs.create({ url: 'https://www.vinted.fr/catalog?search_text=veste', active: true });
    await keep(shown.id!, 0);
    await closeIdleSearchTab(SEARCH_TAB_IDLE_MS);
    expect((await fakeBrowser.tabs.get(shown.id!)).id).toBe(shown.id);
  });
});
