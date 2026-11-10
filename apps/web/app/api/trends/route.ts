import { visibilityVersion } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { memo } from '@/lib/server/cache';
import { routeCtx } from '@/lib/server/ctx';
import { failure, json } from '@/lib/server/http';
import { trends } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    const c = await routeCtx(req);
    // Keyed on the visibility version, so a hidden post stops counting at once.
    return json(await memo(`trends:${c.country}:${await visibilityVersion(c.sql)}`, 60_000, () => trends(c)));
  } catch (error) {
    return failure(error);
  }
}
