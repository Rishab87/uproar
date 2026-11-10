import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { bad, failure, json } from '@/lib/server/http';
import { getProfileByHandle, profileFeed, type ProfileFeedTab } from '@/lib/server/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  try {
    const { handle } = await params;
    const { searchParams } = new URL(req.url);
    const tab = (['posts', 'replies', 'likes'].includes(searchParams.get('tab') ?? '') ? searchParams.get('tab') : 'posts') as ProfileFeedTab;
    const c = await routeCtx(req);
    const page = await getProfileByHandle(c, handle);
    if (!page) return bad('Not found', 404);
    if (page.tombstone) return json({ items: [], nextCursor: null });
    return json(await profileFeed(c, page.profile.address, { tab, cursor: searchParams.get('cursor') ?? undefined }));
  } catch (error) {
    return failure(error);
  }
}
