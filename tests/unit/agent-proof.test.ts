import { describe, expect, it } from 'vitest';
import { type ProofRow, agentProof } from '@/intelligence/agent-proof';

const r = (p: Partial<ProofRow>): ProofRow => ({ at: 1000, kind: 'FAV_MESSAGE', ok: true, dryRun: false, detail: '« Hello »', ...p });

describe('what each agent has already done on the seller’s own account', () => {
  it('never seen: nothing real in the journal — a simulation proves nothing', () => {
    expect(agentProof([], 'fav').state).toBe('UNSEEN');
    expect(agentProof([r({ dryRun: true })], 'fav')).toMatchObject({ state: 'UNSEEN', n: 0 });
  });

  it('proven: accepted by Vinted for real, counted; another agent’s rows do not count', () => {
    const rows = [r({ at: 1 }), r({ at: 5, kind: 'FAV_OFFER' }), r({ at: 9, kind: 'DELIVERED_MESSAGE' })];
    expect(agentProof(rows, 'fav')).toEqual({ state: 'PROVEN', n: 2, lastOk: 5, lastFail: null });
    expect(agentProof(rows, 'delivered')).toMatchObject({ state: 'PROVEN', n: 1 });
    expect(agentProof(rows, 'replies').state).toBe('UNSEEN');
  });

  it('sent but never shown back by Vinted: said as such, never as proven (old rows said it in their detail)', () => {
    expect(agentProof([r({ kind: 'DELIVERED_MESSAGE', unconfirmed: true })], 'delivered')).toMatchObject({ state: 'UNCONFIRMED', n: 0 });
    expect(agentProof([r({ kind: 'PRICE', detail: 'prix 23,00 € · non confirmé' })], 'priceCuts').state).toBe('UNCONFIRMED');
  });

  it('refused: Vinted refused the last real attempt, after the last success — ERA’s own limits are not refusals', () => {
    const ok = r({ at: 10, kind: 'OFFER_ACCEPT' });
    const refused = r({ at: 20, kind: 'OFFER_COUNTER', ok: false, detail: 'NETWORK_403 · HTTP 403' });
    expect(agentProof([ok, refused], 'offers')).toMatchObject({ state: 'REFUSED', n: 1, lastFail: { at: 20, detail: 'NETWORK_403 · HTTP 403' } });
    // A success after the refusal: proven again.
    expect(agentProof([ok, refused, r({ at: 30, kind: 'OFFER_REJECT' })], 'offers').state).toBe('PROVEN');
    // The budget held ERA back: nothing refused by Vinted.
    expect(agentProof([ok, r({ at: 40, kind: 'OFFER_ACCEPT', ok: false, detail: 'BUDGET_EXHAUSTED · budget de la session' })], 'offers').state).toBe('PROVEN');
  });

  it('a repost is proven by its steps on Vinted: the copy published, the old listing deleted', () => {
    expect(agentProof([r({ kind: 'PUBLISH', detail: 'brouillon 555 publié, relu sur Vinted' })], 'reposts').state).toBe('PROVEN');
    expect(agentProof([r({ kind: 'LABEL' })], 'labels').n).toBe(1);
  });
});
