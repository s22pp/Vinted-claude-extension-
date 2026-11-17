import { describe, expect, it } from 'vitest';
import { isNewer } from '@/intelligence/version';

describe('a newer version on disk', () => {
  it('part by part, never by text', () => {
    expect(isNewer('0.37.0', '0.36.2')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0', '0.99.99')).toBe(true);
    expect(isNewer('0.36.0', '0.36.0')).toBe(false);
    expect(isNewer('0.35.9', '0.36.0')).toBe(false);
  });
  it('unreadable: never newer', () => {
    expect(isNewer(null, '0.36.0')).toBe(false);
    expect(isNewer('beta', '0.36.0')).toBe(false);
  });
});
