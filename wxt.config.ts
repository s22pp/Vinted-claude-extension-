import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ERA Intelligence',
    description: 'Cockpit de décision pour revendeurs Vinted : stock, capital, marché, achats, apprentissage.',
    // scripting + activeTab: on your click only, read the product the open shop page publishes (sourcing).
    // alarms: the automations' schedule — off unless you switch it on, and only with a vinted.fr tab open.
    permissions: ['sidePanel', 'activeTab', 'scripting', 'storage', 'unlimitedStorage', 'alarms'],
    // vinted.fr only: read the page you have open, call its API with your session — reads, plus the few
    // whitelisted writes of the automations you switch on (EXPERIMENTAL).
    host_permissions: ['https://www.vinted.fr/*'],
    action: { default_title: 'ERA Intelligence' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    // Public key only: pins the extension ID (mjcnlfhbedofkagpnhdmghgmgbbbhpni) whatever folder it is loaded from,
    // so local data (IndexedDB) survives updates. No private key is needed or stored.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwtGZ8zxf8xrZHEflkMKMx+YGZCMo24Hgw+fmXyBpRF91y4qUTvriBeTWrcSBzSBPxFiGwRf1JG7NpNKBShz79iOKvmO1qjOT8AuIgqBZZ4khDbhvAYgl1caccGQsgSuWrqHjeqcYHSQJke2foXtaK9lJb2Xn9mmd99u0NAdT8uVFkJaj8BmPm0LyAgRudu1U6Pt7kl/Zv02poa3jopoPwdhDTLf/ZWrZTETsnDY0b+Lkf2RzlPiShEY+N6B2UwUik0XOAaKdBdzuRyoiLU4wv2jx22Wkt70vAOVDoOyowNRdwSVksxJv8ZZKXyJkEcj8NSn6Pdgvc/EzOHYbqiEW4QIDAQAB',
  },
});
