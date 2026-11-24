import { describe, expect, it } from 'vitest';
import { mayResend, neverArrived } from '@/data/adapters/vinted/tabs';

describe('a message to the Vinted tab that did not get through', () => {
  const notThere = new Error('Could not establish connection. Receiving end does not exist.');
  const lostAnswer = new Error('The message port closed before a response was received.');

  it('knows when it never reached the page (a reloading page) — and when it may have', () => {
    expect(neverArrived(notThere)).toBe(true);
    expect(neverArrived(lostAnswer)).toBe(false);
    expect(neverArrived('Receiving end does not exist')).toBe(true);
  });

  it('a read is sent again; a write only when it provably never arrived — never twice on Vinted', () => {
    expect(mayResend(lostAnswer, 'read')).toBe(true);
    expect(mayResend(notThere, 'write')).toBe(true);
    expect(mayResend(lostAnswer, 'write')).toBe(false);
  });
});
