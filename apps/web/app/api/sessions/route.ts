import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { bad, failure, json } from '@/lib/server/http';
import { sessionsOf } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    const c = await routeCtx(req);
    if (!c.viewer) return bad('Sign in first', 401);
    return json(await sessionsOf(c, c.viewer));
  } catch (error) {
    return failure(error);
  }
}
