import { parseMoneyInput, roi, subKnown, sumMetric } from '@/domain/money';

describe('money', () => {
  it('parses user input to integer cents, empty = unknown', () => {
    expect(parseMoneyInput('18')).toBe(1800);
    expect(parseMoneyInput('18,5')).toBe(1850);
    expect(parseMoneyInput(' 1 250,00 € ')).toBe(125000);
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('abc')).toBeUndefined();
    expect(parseMoneyInput('1.234')).toBeUndefined();
  });

  it('UNKNOWN is never ZERO', () => {
    expect(subKnown(4500, null)).toBeNull();
    expect(roi(1000, null)).toBeNull();
    expect(roi(1000, 0)).toBeNull();
    expect(sumMetric([null, null])).toEqual({ status: 'unknown', missing: 2 });
    expect(sumMetric([1000, null, 500])).toEqual({ status: 'partial', value: 1500, count: 2, missing: 1 });
    expect(sumMetric([1000, 0])).toEqual({ status: 'known', value: 1000, count: 2 });
    expect(sumMetric([])).toEqual({ status: 'unknown', missing: 0 });
  });
});
