import type { Metadata } from 'next';
import { AppealForm } from '@/components/AppealForm';
import { LegalHead } from '@/components/LegalHead';

export const metadata: Metadata = { title: 'Appeal', description: 'Appeal a decision to hide a post or account on UPROAR.', robots: { index: false } };

export default async function AppealPage({ searchParams }: { searchParams: Promise<{ type?: string; target?: string }> }) {
  const { type, target } = await searchParams;
  return (
    <>
      <LegalHead title="Appeal a decision" />
      <article className="page">
        <p className="lede">If we hid your post or account and you think we got it wrong, tell us why. A person reviews every appeal and replies in writing within 7 days.</p>
        <div style={{ marginTop: 16 }}><AppealForm initialType={type === 'profile' ? 'profile' : 'post'} initialTarget={(target ?? '').slice(0, 100)} /></div>
      </article>
    </>
  );
}
