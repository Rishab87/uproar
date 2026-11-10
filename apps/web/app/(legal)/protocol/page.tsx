import { UPROAR_PROGRAM_ADDRESS } from '@uproar/protocol';
import type { Metadata } from 'next';
import { LegalHead } from '@/components/LegalHead';

export const metadata: Metadata = { title: 'Run your own', description: 'UPROAR is an open protocol on Solana. Run your own indexer and your own app.' };

const repo = process.env.NEXT_PUBLIC_REPO_URL;

export default function ProtocolPage() {
  return (
    <>
      <LegalHead title="Run your own" />
      <article className="page">
        <p className="lede">This app is one reader of a public program. If you disagree with how it runs, you can read the same chain and make your own choices.</p>
        <h2>The program</h2>
        <p>Program address: <code>{UPROAR_PROGRAM_ADDRESS}</code></p>
        {repo ? <p>Source code, IDL and indexer: <a href={repo} target="_blank" rel="noopener noreferrer">{repo.replace('https://', '')}</a></p> : <p>The source code, IDL and indexer are published when the network launches on mainnet.</p>}
        <h2>How data is stored</h2>
        <p>Names, profiles and session keys are accounts, because the chain has to enforce them. Everything else is an instruction: the text of a post lives in the signed transaction. The program accepts an instruction only if the signer may speak for that profile, so a successful transaction is the proof that a post is real.</p>
        <h2>The indexing rules</h2>
        <ol className="list">
          <li>Read only top-level instructions of successful transactions. The program rejects calls from other programs, so nothing else can count.</li>
          <li>A post&apos;s ID is its transaction signature. If a transaction holds more than one post, only the first counts.</li>
          <li>Order events by slot, then by signature in bytewise order, then by instruction index.</li>
          <li>Likes, reposts, follows, pins and profile edits are last-write-wins in that order.</li>
          <li>Name ownership follows moves in and out of each profile. The holder is whoever has one more in than out, which doesn&apos;t depend on order inside a slot.</li>
          <li>A delete counts only if it comes from the post&apos;s author.</li>
        </ol>
        <p>Follow these rules and you reach the same state as this app&apos;s chain data, byte for byte. The indexer can print a state hash to compare.</p>
        <h2>Running the indexer</h2>
        <pre><code>{`DATABASE_URL=postgres://... RPC_URLS=https://... uproar-indexer migrate
DATABASE_URL=postgres://... RPC_URLS=https://... uproar-indexer backfill
DATABASE_URL=postgres://... RPC_URLS=https://... uproar-indexer hash`}</code></pre>
        <h2>What running your own means</h2>
        <p>If you run a public app, you are responsible for what it shows, under the laws that apply to you.</p>
      </article>
    </>
  );
}
