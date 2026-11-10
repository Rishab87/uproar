import type { Metadata } from 'next';
import { ThreadScreen } from '@/components/ThreadScreen';
import { pageCtx } from '@/lib/server/ctx';
import { isValidSignature } from '@/lib/server/http';
import { getThread, restrictedAnywhere } from '@/lib/server/queries';
import { notFound } from 'next/navigation';

type Props = { params: Promise<{ sig: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sig } = await params;
  if (!isValidSignature(sig)) return { title: 'Post' };
  const c = await pageCtx();
  const thread = await getThread(c, sig);
  const post = thread?.post;
  // Previews travel: a crawler abroad would carry the text back to where it's withheld. So anything
  // hidden or withheld in any country gets a blank card.
  if (!post || post.tombstone || (await restrictedAnywhere(c, 'post', sig)) || (post.author && (await restrictedAnywhere(c, 'profile', post.author.address)))) {
    return { title: 'Post', robots: { index: false } };
  }
  const who = post.author?.name || (post.author?.handle ? `@${post.author.handle}` : 'UPROAR');
  const text = (post.text ?? '').slice(0, 200);
  const image = `/api/og/post/${sig}`;
  return {
    title: `${who}: "${text.slice(0, 70)}"`,
    description: text,
    openGraph: { type: 'article', title: who, description: text, images: [image] },
    twitter: { card: 'summary_large_image', title: who, description: text, images: [image] },
  };
}

export default async function PostPage({ params }: Props) {
  const { sig } = await params;
  if (!isValidSignature(sig)) notFound();
  const thread = await getThread(await pageCtx(), sig);
  return <ThreadScreen sig={sig} initial={thread} />;
}
