import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { bad, failure, isValidSignature, json } from '@/lib/server/http';
import { getThread } from '@/lib/server/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ sig: string }> }) {
  try {
    const { sig } = await params;
    if (!isValidSignature(sig)) return bad('Not a post id');
    const cursor = new URL(req.url).searchParams.get('cursor') ?? undefined;
    const thread = await getThread(await routeCtx(req), sig, { cursor });
    return thread ? json(thread) : bad('Not found', 404);
  } catch (error) {
    return failure(error);
  }
}
