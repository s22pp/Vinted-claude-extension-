import { describe, expect, it } from 'vitest';
import { labelFileName, shippingChecklist } from '@/intelligence/shipping';

describe('pre-shipping checklist from past refunds', () => {
  it('always the basics; the refunds add what would have prevented them', () => {
    expect(shippingChecklist([]).checks).toEqual(['MATCHES_LISTING', 'PHOTO_BEFORE', 'PACKAGE_SIZE', 'OLD_BARCODE']);
    const l = shippingChecklist(['PACKAGING', 'DEFECT_PHOTOS', 'CONDITION_DETAIL', 'DESCRIPTION_CHECK']);
    expect(l.learned).toEqual(['PROTECTED', 'DEFECTS_SHOWN']);
    expect(l.checks).toEqual(['MATCHES_LISTING', 'PHOTO_BEFORE', 'PROTECTED', 'DEFECTS_SHOWN', 'PACKAGE_SIZE', 'OLD_BARCODE']);
  });
});

describe('label files', () => {
  it('are named by sale date and article, safe on every system', () => {
    const at = Date.UTC(2026, 8, 20, 12);
    expect(labelFileName('Sweat Nike vintage L', at)).toBe('ERA-bordereaux/2026-09-20_sweat-nike-vintage-l.pdf');
    expect(labelFileName('Veste « Marlboro Classics » / été', at)).toBe('ERA-bordereaux/2026-09-20_veste-marlboro-classics-ete.pdf');
    expect(labelFileName('../../etc/passwd', at)).toBe('ERA-bordereaux/2026-09-20_etc-passwd.pdf');
    expect(labelFileName('★★★', at)).toBe('ERA-bordereaux/2026-09-20_commande.pdf');
    expect(labelFileName('a'.repeat(200), at).length).toBeLessThanOrEqual('ERA-bordereaux/2026-09-20_'.length + 60 + 4);
  });
});

describe('parcels to watch', () => {
  const now = Date.UTC(2026, 8, 26);
  const day = 86_400_000;
  it('sent and not delivered after a week, delivered and not completed after 3 days — from Vinted’s words', async () => {
    const { parcelAlerts } = await import('@/intelligence/shipping');
    const s = (id: string, vintedStatus: string, soldDaysAgo: number, sinceDaysAgo: number | null = null, extra = {}) => ({ id, status: 'COMPLETED', soldAt: now - soldDaysAgo * day, vintedStatus, vintedStatusSince: sinceDaysAgo === null ? null : now - sinceDaysAgo * day, ...extra });
    const a = parcelAlerts(
      [
        s('a', 'Colis envoyé', 10),
        s('b', 'Colis envoyé', 3),
        s('c', 'Livré', 9, 4),
        s('d', 'Livré', 9, 1),
        s('e', 'Terminée', 30),
        s('f', 'Envoi à préparer', 20, null, { needsAction: true }),
        s('g', 'Colis envoyé', 20, null, { status: 'REFUNDED' }),
      ],
      now,
    );
    expect(a.map((x) => [x.saleId, x.state, x.days, x.since])).toEqual([
      ['a', 'SHIPPED', 10, 'SALE'],
      ['c', 'DELIVERED', 4, 'STATUS'],
    ]);
  });
});
