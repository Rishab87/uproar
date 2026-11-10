import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { failure, json } from '@/lib/server/http';
import { stats } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    return json(await stats(await routeCtx(req)));
  } catch (error) {
    return failure(error);
  }
}
