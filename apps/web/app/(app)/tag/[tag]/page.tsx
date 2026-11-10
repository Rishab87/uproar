import type { Metadata } from 'next';
import { Feed } from '@/components/Feed';
import { BackHead } from '@/components/ThreadScreen';
import { pageCtx } from '@/lib/server/ctx';
import { tagFeed } from '@/lib/server/queries';

type Props = { params: Promise<{ tag: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${decodeURIComponent(tag)}` };
}

export default async function TagPage({ params }: Props) {
  const { tag } = await params;
  const clean = decodeURIComponent(tag);
  const initial = await tagFeed(await pageCtx(), clean, {});
  return (
    <>
      <BackHead title={`#${clean}`} />
      <Feed path={`/api/tag/${encodeURIComponent(clean)}`} initial={initial} empty={<p>No posts with this tag yet.</p>} />
    </>
  );
}
