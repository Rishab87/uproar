import type { Metadata } from 'next';
import { AppealStatusView } from '@/components/AppealStatus';
import { LegalHead } from '@/components/LegalHead';

export const metadata: Metadata = { title: 'Appeal status', robots: { index: false }, referrer: 'no-referrer' };

export default async function AppealStatusPage({ searchParams }: { searchParams: Promise<{ ref?: string; token?: string }> }) {
  const { ref, token } = await searchParams;
  return (
    <>
      <LegalHead title="Appeal status" />
      <article className="page"><AppealStatusView refId={(ref ?? '').slice(0, 40)} token={(token ?? '').slice(0, 100)} /></article>
    </>
  );
}
