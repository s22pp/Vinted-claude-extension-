import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ERA Intelligence',
    description: 'Cockpit de décision pour revendeurs Vinted : stock, capital, marché, achats, apprentissage.',
    permissions: ['sidePanel', 'activeTab', 'storage', 'unlimitedStorage'],
    // Read-only access to vinted.fr, only to read the page you have open and to call its API with your session.
    host_permissions: ['https://www.vinted.fr/*'],
    action: { default_title: 'ERA Intelligence' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  },
});
