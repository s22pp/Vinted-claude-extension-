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
