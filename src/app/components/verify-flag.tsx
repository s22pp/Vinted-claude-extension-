import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { integrationRecords } from '@/data/integration-records';
import { type IntegKey, integrationStatus } from '@/data/integrations';
import { PAGE_PROOF_KEYS, type PageProof } from '@/data/page-proofs';
import { Flag } from '@/ui/components/primitives';

export type Proof = IntegKey | PageProof;

const isPage = (p: Proof): p is PageProof => p in PAGE_PROOF_KEYS;

/**
 * Has this feature been seen working on THIS device? For a Vinted route, the integrations register says so (a read
 * that brought data, a write Vinted accepted and showed back); for what ERA does inside Vinted's pages, the content
 * script's own note. undefined while it is being read.
 */
export function useProven(proof: Proof): boolean | undefined {
  const page = isPage(proof) ? PAGE_PROOF_KEYS[proof] : null;
  const fromRegister = useLiveQuery(async () => (page ? null : integrationStatus(await integrationRecords()).find((r) => r.key === proof)?.state === 'VERIFIED'), [proof]);
  const [fromPage, setFromPage] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!page) return;
    let alive = true;
    const read = () =>
      void browser.storage.local
        .get(page)
        .then((v) => alive && setFromPage(!!v[page]))
        .catch(() => alive && setFromPage(false));
    read();
    const on = (changes: Record<string, unknown>, area: string) => area === 'local' && page in changes && read();
    browser.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(on);
    };
  }, [page]);
  return page ? fromPage : (fromRegister ?? undefined);
}

/**
 * The EXPERIMENTAL / NON VÉRIFIÉ label, until the feature has been seen working on this device — then nothing: once
 * proven, the screen stops warning about it. Never removed on the strength of the test fixtures, only of the account.
 */
export function VerifyFlag({ proof, kind = 'EXPERIMENTAL', title }: { proof: Proof; kind?: 'EXPERIMENTAL' | 'UNVERIFIED'; title?: string }) {
  const proven = useProven(proof);
  // Proven while on screen: the label fades out (200 ms) instead of vanishing.
  const was = useRef(proven);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const before = was.current;
    was.current = proven;
    if (before !== false || proven !== true) return;
    setLeaving(true);
    const id = window.setTimeout(() => setLeaving(false), 220);
    return () => window.clearTimeout(id);
  }, [proven]);
  if (proven === false) return <Flag kind={kind} title={title} />;
  return leaving ? <Flag kind={kind} title={title} leaving /> : null;
}

/** Words that only matter while the feature is unproven (a « not yet verified on your account » sentence). */
export function UntilProven({ proof, children }: { proof: Proof; children: ReactNode }) {
  return useProven(proof) === false ? <>{children}</> : null;
}

/** Words for once the feature has been seen working (the calm version of a warning). */
export function ProvenOnly({ proof, children }: { proof: Proof; children: ReactNode }) {
  return useProven(proof) === true ? <>{children}</> : null;
}
