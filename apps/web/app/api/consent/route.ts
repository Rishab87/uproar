import type { NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { verifiedViewer } from '@/lib/server/auth';
import { bad, failure, json, logRequest, readBody } from '@/lib/server/http';
import { CONSENT_VERSION } from '@/lib/shared/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 512);
    if (body instanceof Response) return body;
    const viewer = await verifiedViewer(req, body.raw);
    if (!viewer) return bad('Sign in first', 401);
    await getSql()`insert into consents (profile, version) values (${viewer}, ${CONSENT_VERSION}) on conflict do nothing`;
    await logRequest(req, 200, viewer);
    return json({ ok: true, version: CONSENT_VERSION });
  } catch (error) {
    return failure(error);
  }
}
