import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { bad, failure, json } from '@/lib/server/http';
import { notifications } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    const c = await routeCtx(req);
    if (!c.viewer) return bad('Sign in first', 401);
    return json(await notifications(c, { cursor: new URL(req.url).searchParams.get('cursor') ?? undefined }));
  } catch (error) {
    return failure(error);
  }
}
