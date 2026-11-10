import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { failure, json } from '@/lib/server/http';
import { searchPosts, searchProfiles, tagFeed } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') ?? '').slice(0, 120);
    const cursor = searchParams.get('cursor') ?? undefined;
    const c = await routeCtx(req);
    if (searchParams.get('type') === 'people') return json(await searchProfiles(c, q, { cursor }));
    return json(q.startsWith('#') ? await tagFeed(c, q, { cursor }) : await searchPosts(c, q, { cursor }));
  } catch (error) {
    return failure(error);
  }
}
