import type { NextRequest } from 'next/server';
import { currentAdmin } from './auth';
import { bad, sameOrigin } from './http';

/** Every console route goes through this: a valid operator cookie, and same-origin for writes. */
export async function requireAdmin(req: NextRequest): Promise<{ admin: string } | Response> {
  if (req.method !== 'GET' && !sameOrigin(req)) return bad('Not allowed', 403);
  const admin = await currentAdmin();
  return admin ? { admin } : bad('Sign in to the console first', 401);
}
