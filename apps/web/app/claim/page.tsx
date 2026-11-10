import type { Metadata } from 'next';
import { ClaimFlow } from '@/components/ClaimFlow';
import { ConnectOnly } from '@/components/ConnectOnly';
import { Wordmark } from '@/components/Shell';

export const metadata: Metadata = { title: 'Claim your name', description: 'Claim your name on UPROAR. It lives on Solana, under your wallet.' };

export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const { h } = await searchParams;
  return (
    <main className="claim">
      <div className="claim-corner"><Wordmark /></div>
      <ClaimFlow initialHandle={(h ?? '').slice(0, 16)} />
      <ConnectOnly />
    </main>
  );
}
