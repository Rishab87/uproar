import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/server/env';
import { bad, failure, json } from '@/lib/server/http';
import { runMaintenance } from '@/lib/server/maintenance';

function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return bad('Not allowed', 401);
  try {
    return json(await runMaintenance({ budgetMs: 40_000 }));
  } catch (error) {
    return failure(error);
  }
}

export const GET = handle;
export const POST = handle;
