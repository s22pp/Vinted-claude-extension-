import { describe, expect, it } from 'vitest';
import type { ContactRow } from '@/intelligence/outcomes';
import { contactsCsv, weeklyDue, weeklyFileName, weeklyNotice } from '@/intelligence/weekly';

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime(); // 16 Nov 2026 is a Monday

describe('the week’s task', () => {
  it('due on the chosen day, once; caught up after 8 days without it', () => {
    expect(weeklyDue(at(16, 9), 1, null)).toBe(true);
    expect(weeklyDue(at(16, 13), 1, at(16, 9))).toBe(false);
    expect(weeklyDue(at(17, 9), 1, at(16, 9))).toBe(false);
    expect(weeklyDue(at(23, 9), 1, at(16, 9))).toBe(true);
    expect(weeklyDue(at(25, 9), 1, at(16, 9))).toBe(true); // Monday 23 missed (Chrome closed)
    expect(weeklyDue(at(18, 9), 1, null)).toBe(false);
  });

  it('the notice: the week, what worked, what the week asks, where the data is', () => {
    const n = weeklyNotice({ digest: { title: 'Semaine : 2 ventes · 85 €', lines: ['Mises en ligne : 3'] }, best: ['message « Bonjour {pseudo} » : 60 % de réponses'], contactsThisWeek: 9, priceCuts: 2, toList: 0, toRepost: 1, file: { ok: true, file: 'ERA-bilans/semaine-2026-11-16.csv' } });
    expect(n.title).toBe('Bilan de la semaine · 2 ventes · 85 €');
    expect(n.lines).toEqual([
      'Mises en ligne : 3',
      'Ce qui marche : message « Bonjour {pseudo} » : 60 % de réponses',
      'Cette semaine pour vous : 2 baisses de prix prévues · 1 annonce à republier (en ligne depuis 30 jours ou plus, sans favori : Outils → Republier)',
      'Données relevées : ERA-bilans/semaine-2026-11-16.csv',
    ]);
    expect(weeklyNotice({ digest: { title: 'Semaine : aucune vente', lines: [] }, best: [], contactsThisWeek: 1, priceCuts: 0, toList: 0, toRepost: 0, file: null }).lines).toEqual([
      'Ce qui marche : pas encore assez d’envois mesurés pour conclure (1 envoi cette semaine)',
      'Cette semaine pour vous : rien en retard',
    ]);
  });

  it('the data file: one line per contact with what followed, French Excel', () => {
    const row: ContactRow = { id: 'c1', at: Date.UTC(2026, 10, 10, 8), kind: 'FAV_OFFER', conversationId: '1', itemId: 'i1', title: 'Veste; laine', variant: null, askCents: 4000, offerCents: 3600, delayMs: 5_400_000, repliedAt: null, soldAt: Date.UTC(2026, 10, 12, 9), soldCents: 3600 };
    const csv = contactsCsv([row]);
    expect(csv.startsWith('﻿Date;Type;Article;')).toBe(true);
    expect(csv).toContain('2026-11-10 08:00;Favori → offre;"Veste; laine";;40,00;36,00;90;1,5;;2026-11-12 09:00;36,00');
    expect(weeklyFileName(at(16, 9))).toBe('ERA-bilans/semaine-2026-11-16.csv');
  });
});
