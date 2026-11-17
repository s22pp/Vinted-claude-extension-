/**
 * What each autopilot agent has already done for real on the seller's own Vinted account, from ERA's journal alone
 * (pure). Tests on a fake Vinted prove ERA's logic; only these rows prove the real integration — so each agent says
 * which one it is: proven here, sent but never shown back, refused last time, or never seen here yet.
 */

export type PilotAgent = 'offers' | 'fav' | 'delivered' | 'replies' | 'priceCuts' | 'reposts' | 'labels';

/** The journal kinds behind each agent (what it writes on Vinted). */
export const AGENT_KINDS: Record<PilotAgent, readonly string[]> = {
  offers: ['OFFER_ACCEPT', 'OFFER_REJECT', 'OFFER_COUNTER'],
  fav: ['FAV_MESSAGE', 'FAV_BUNDLE', 'FAV_OFFER'],
  delivered: ['DELIVERED_MESSAGE'],
  replies: ['REPLY'],
  // The same price edit as the seller's own from ERA: seen working once, the route is proven.
  priceCuts: ['PRICE'],
  // A repost is a copy published, then the old listing deleted.
  reposts: ['REPOST', 'PUBLISH', 'DELETE'],
  labels: ['LABEL'],
};

export interface ProofRow {
  at: number;
  kind: string;
  ok: boolean;
  dryRun: boolean;
  detail: string;
  unconfirmed?: boolean;
}

/** Sent and accepted, but not shown back by Vinted (rows before 0.31.1 said it only in their detail). */
export const isUnconfirmedRow = (r: Pick<ProofRow, 'unconfirmed' | 'detail'>) => r.unconfirmed === true || /non (vérifié|confirmé)/.test(r.detail);

/** ERA's own limits (budget, spacing, daily cap): ERA held back, Vinted refused nothing. */
const OWN_LIMIT = /BUDGET_EXHAUSTED|WRITE_COOLDOWN|plafond du jour|opération Vinted est en cours/;

/**
 * PROVEN: accepted by Vinted on this account (a simulation never counts). UNCONFIRMED: sent, Vinted did not show it back.
 * REFUSED: the last real attempt was refused (after the last success, if any). UNSEEN: never tried for real here.
 */
export type ProofState = 'PROVEN' | 'UNCONFIRMED' | 'REFUSED' | 'UNSEEN';

export interface AgentProof {
  state: ProofState;
  /** Actions accepted for real. */
  n: number;
  lastOk: number | null;
  lastFail: { at: number; detail: string } | null;
}

export function agentProof(rows: readonly ProofRow[], agent: PilotAgent): AgentProof {
  const kinds = AGENT_KINDS[agent];
  const mine = rows.filter((r) => !r.dryRun && kinds.includes(r.kind));
  const ok = mine.filter((r) => r.ok && !isUnconfirmedRow(r));
  const unconfirmed = mine.filter((r) => r.ok && isUnconfirmedRow(r));
  const fail = mine.filter((r) => !r.ok && !OWN_LIMIT.test(r.detail)).sort((a, b) => b.at - a.at)[0] ?? null;
  const lastOk = ok.length ? Math.max(...ok.map((r) => r.at)) : null;
  const lastFail = fail ? { at: fail.at, detail: fail.detail } : null;
  const state: ProofState = lastFail && (lastOk === null || lastFail.at > lastOk) ? 'REFUSED' : ok.length ? 'PROVEN' : unconfirmed.length ? 'UNCONFIRMED' : 'UNSEEN';
  return { state, n: ok.length, lastOk, lastFail };
}
