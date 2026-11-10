import type { Metadata } from 'next';
import { LegalHead } from '@/components/LegalHead';
import { ReportStatusView } from '@/components/ReportStatus';

export const metadata: Metadata = { title: 'Report status', robots: { index: false }, referrer: 'no-referrer' };

export default async function ReportStatusPage({ searchParams }: { searchParams: Promise<{ ref?: string; token?: string }> }) {
  const { ref, token } = await searchParams;
  return (
    <>
      <LegalHead title="Report status" />
      <article className="page"><ReportStatusView refId={(ref ?? '').slice(0, 40)} token={(token ?? '').slice(0, 100)} /></article>
    </>
  );
}
