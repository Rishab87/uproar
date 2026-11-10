import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalHead } from '@/components/LegalHead';
import { ReportForm } from '@/components/ReportForm';

export const metadata: Metadata = { title: 'Report', description: 'Report a post or account on UPROAR. No wallet or account needed.', robots: { index: false } };

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ type?: string; target?: string }> }) {
  const { type, target } = await searchParams;
  return (
    <>
      <LegalHead title="Report" />
      <article className="page">
        <p className="lede">You don&apos;t need a wallet or an account to report. Reports go to a person, on the deadlines the law sets. See the <Link prefetch={false} href="/rules">Rules</Link> for how decisions are made.</p>
        <div style={{ marginTop: 16 }}>
          <ReportForm type={type === 'profile' ? 'profile' : 'post'} presetTarget={(target ?? '').slice(0, 100)} />
        </div>
      </article>
    </>
  );
}
