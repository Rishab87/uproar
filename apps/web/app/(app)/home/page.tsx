import { visibilityVersion } from '@uproar/safety';
import type { Metadata } from 'next';
import { HomeScreen } from '@/components/HomeScreen';
import { memo } from '@/lib/server/cache';
import { pageCtx } from '@/lib/server/ctx';
import { feedForYou } from '@/lib/server/queries';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage() {
  const c = await pageCtx();
  // Same key as the feed API: keyed on the visibility version, so a removal is never served from cache.
  const initial = await memo(`foryou:${c.country}:${await visibilityVersion(c.sql)}`, 20_000, () => feedForYou(c, {}));
  return <HomeScreen initial={initial} />;
}
