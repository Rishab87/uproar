import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { failure, json } from '@/lib/server/http';
import { whoToFollow } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    return json(await whoToFollow(await routeCtx(req), 4));
  } catch (error) {
    return failure(error);
  }
}
