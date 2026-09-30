import { describe, expect, it } from 'vitest';
import { formatPrice, readCents } from '@/data/adapters/vinted/edit-form';
import { mapCsv, parseCsv } from '@/data/import-csv';

describe('CSV import (a spreadsheet of articles)', () => {
  it('French Excel: « ; », quotes, a line without title or brand skipped, costs never guessed', () => {
    const rows = parseCsv('Titre;Marque;État;Prix achat;Prix;Statut\r\n"Veste ""Harrington"" M";Ralph Lauren;Très bon état;18,50;59;En ligne\r\n;Nike;;;;\r\nJean 501;Levi’s;;;30;brouillon\r\n');
    expect(rows[1]![0]).toBe('Veste "Harrington" M');
    const { items, skipped } = mapCsv(rows);
    expect(skipped).toBe(1);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Veste "Harrington" M', brand: 'Ralph Lauren', category: 'JACKET', condition: 'VERY_GOOD', purchasePriceCents: 1850, priceCents: 5900, status: 'LISTED' });
    expect(items[1]).toMatchObject({ category: 'JEANS', purchasePriceCents: null, status: 'DRAFT' });
  });

  it('a comma-separated file works the same', () => {
    const { items } = mapCsv(parseCsv('title,brand,price\nSweat,Nike,25\n'));
    expect(items[0]).toMatchObject({ title: 'Sweat', brand: 'Nike', priceCents: 2500 });
  });
});

describe('price typed into Vinted’s edit form', () => {
  it('whole euros without decimals, cents with a comma; read back from what the field shows', () => {
    expect(formatPrice(5900)).toBe('59');
    expect(formatPrice(5950)).toBe('59,50');
    expect(readCents('59,50 €')).toBe(5950);
    expect(readCents('€59.00')).toBe(5900);
    expect(readCents('')).toBeNull();
    // Thousands separators, as Vinted or a browser may write them.
    expect(readCents('1 234,50 €')).toBe(123450);
    expect(readCents('1.234,50')).toBe(123450);
    expect(readCents('1.234')).toBe(123400);
    expect(readCents('12.5')).toBe(1250);
  });
});
