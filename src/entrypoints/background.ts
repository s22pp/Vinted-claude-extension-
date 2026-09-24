export default defineBackground(() => {
  // The service worker may be killed at any time: it holds no state, everything lives in IndexedDB.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/onboarding` });
  });
  void browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);
});
