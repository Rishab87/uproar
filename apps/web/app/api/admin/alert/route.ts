import { acknowledgeAlert } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin';
import { getSql } from '@/lib/server/db';
import { failure, json, readBody } from '@/lib/server/http';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await readBody(req, 512);
    if (body instanceof Response) return body;
    await acknowledgeAlert(getSql(), String((body.data as { id?: unknown }).id ?? ''));
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
