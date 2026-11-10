import type { NextRequest } from 'next/server';
import { clearAdminCookie } from '@/lib/server/auth';
import { bad, json, sameOrigin } from '@/lib/server/http';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return bad('Not allowed', 403);
  await clearAdminCookie();
  return json({ ok: true });
}
