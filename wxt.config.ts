import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ERA Intelligence',
    description: 'Cockpit de décision pour revendeurs Vinted : stock, capital, marché, achats, apprentissage.',
    permissions: ['sidePanel', 'activeTab', 'unlimitedStorage'],
    action: { default_title: 'ERA Intelligence' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  },
});
