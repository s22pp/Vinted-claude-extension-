import type { Dict } from './fr';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** English overlay — missing keys fall back to French. */
export const en: DeepPartial<Dict> = {
  app: {
    tagline: 'Decide better.',
    taglineItalic: 'sell smarter.',
    demoBadge: 'DEMO',
    demoBanner: 'Demo data — none of it is real.',
    demoClear: 'Leave demo',
    openEra: 'Open ERA',
    skipToContent: 'Skip to content',
  },
  nav: {
    settings: 'Settings',
    todayHint: 'What should I look at now?',
    stockHint: 'What do I own?',
    marketHint: 'Where does the market sit?',
    buyHint: 'Is this a good buy?',
    salesHint: 'How much do I really make?',
    insightsHint: 'What is ERA learning?',
  },
  data: { unknown: 'Unknown', notProvided: 'Not provided', insufficient: 'Insufficient data' },
  confidence: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', label: 'Confidence' },
  today: { greeting: 'What deserves your attention', priorities: 'Priorities', overview: 'Business overview' },
  settings: { title: 'Settings', theme: 'Theme', themeDark: 'Dark', themeLight: 'Light', themeSystem: 'System', language: 'Language' },
};
