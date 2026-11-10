import { visibilityVersion } from '@uproar/safety';
import { after, type NextRequest } from 'next/server';
import { memo } from '@/lib/server/cache';
import { routeCtx } from '@/lib/server/ctx';
import { failure, json } from '@/lib/server/http';
import { maybeRunMaintenance } from '@/lib/server/maintenance';
import { feedFollowing, feedForYou, feedLatest } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tab = searchParams.get('tab') ?? 'foryou';
    const cursor = searchParams.get('cursor') ?? undefined;
    const c = await routeCtx(req);
    const anonymousFirstPage = !c.viewer && !cursor;
    // The cache key carries the visibility version, so a removal is never served from cache.
    const v = anonymousFirstPage ? await visibilityVersion(c.sql) : '';
    const data =
      tab === 'following'
        ? await feedFollowing(c, { cursor })
        : tab === 'latest'
          ? anonymousFirstPage ? await memo(`latest:${c.country}:${v}`, 10_000, () => feedLatest(c, {})) : await feedLatest(c, { cursor })
          : anonymousFirstPage ? await memo(`foryou:${c.country}:${v}`, 20_000, () => feedForYou(c, {})) : await feedForYou(c, { cursor });
    after(maybeRunMaintenance);
    return json(data);
  } catch (error) {
    return failure(error);
  }
}
