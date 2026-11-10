import type { Metadata } from 'next';
import { ExploreScreen } from '@/components/ExploreScreen';

export const metadata: Metadata = { title: 'Explore' };

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <ExploreScreen q={(q ?? '').slice(0, 120)} />;
}
