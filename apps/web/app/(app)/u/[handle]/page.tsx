import type { Metadata } from 'next';
import { ProfileScreen, UnclaimedProfile } from '@/components/ProfileScreen';
import { pageCtx } from '@/lib/server/ctx';
import { getProfileByHandle, profileFeed, restrictedAnywhere } from '@/lib/server/queries';

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const clean = decodeURIComponent(handle).toLowerCase();
  const c = await pageCtx();
  const page = await getProfileByHandle(c, clean);
  if (!page || page.tombstone || (await restrictedAnywhere(c, 'profile', page.profile.address))) return { title: `@${clean}`, robots: { index: false } };
  const title = page.profile.name ? `${page.profile.name} (@${clean})` : `@${clean}`;
  const image = `/api/og/handle/${clean}`;
  return { title, description: page.profile.bio || `@${clean} on UPROAR`, openGraph: { title, description: page.profile.bio, images: [image] }, twitter: { card: 'summary_large_image', title, images: [image] } };
}

export default async function ProfileRoute({ params }: Props) {
  const { handle } = await params;
  const clean = decodeURIComponent(handle).toLowerCase();
  const c = await pageCtx();
  const page = await getProfileByHandle(c, clean);
  if (!page) return <UnclaimedProfile handle={clean} />;
  const feed = page.tombstone ? { items: [], nextCursor: null } : await profileFeed(c, page.profile.address, { tab: 'posts' });
  return <ProfileScreen handle={clean} initial={page} initialFeed={feed} />;
}
