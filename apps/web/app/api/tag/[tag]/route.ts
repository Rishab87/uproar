import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { failure, json } from '@/lib/server/http';
import { tagFeed } from '@/lib/server/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const { tag } = await params;
    const cursor = new URL(req.url).searchParams.get('cursor') ?? undefined;
    return json(await tagFeed(await routeCtx(req), decodeURIComponent(tag), { cursor }));
  } catch (error) {
    return failure(error);
  }
}
