import { describe, expect, it } from 'vitest';
import { shippingChecklist } from '@/intelligence/shipping';

describe('pre-shipping checklist from past refunds', () => {
  it('always the basics; the refunds add what would have prevented them', () => {
    expect(shippingChecklist([]).checks).toEqual(['MATCHES_LISTING', 'PHOTO_BEFORE', 'PACKAGE_SIZE', 'OLD_BARCODE']);
    const l = shippingChecklist(['PACKAGING', 'DEFECT_PHOTOS', 'CONDITION_DETAIL', 'DESCRIPTION_CHECK']);
    expect(l.learned).toEqual(['PROTECTED', 'DEFECTS_SHOWN']);
    expect(l.checks).toEqual(['MATCHES_LISTING', 'PHOTO_BEFORE', 'PROTECTED', 'DEFECTS_SHOWN', 'PACKAGE_SIZE', 'OLD_BARCODE']);
  });
});
