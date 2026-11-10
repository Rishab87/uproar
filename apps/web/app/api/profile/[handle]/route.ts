import type { NextRequest } from 'next/server';
import { routeCtx } from '@/lib/server/ctx';
import { bad, failure, json } from '@/lib/server/http';
import { getProfileByHandle } from '@/lib/server/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  try {
    const { handle } = await params;
    const page = await getProfileByHandle(await routeCtx(req), handle);
    return page ? json(page) : bad('Not found', 404);
  } catch (error) {
    return failure(error);
  }
}
