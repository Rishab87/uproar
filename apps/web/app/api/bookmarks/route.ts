import type { NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { verifiedViewer } from '@/lib/server/auth';
import { routeCtx } from '@/lib/server/ctx';
import { bad, failure, isValidSignature, json, readBody } from '@/lib/server/http';
import { bookmarks } from '@/lib/server/queries';

export async function GET(req: NextRequest) {
  try {
    const c = await routeCtx(req);
    if (!c.viewer) return bad('Sign in first', 401);
    return json(await bookmarks(c, { cursor: new URL(req.url).searchParams.get('cursor') ?? undefined }));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 1024);
    if (body instanceof Response) return body;
    const viewer = await verifiedViewer(req, body.raw);
    if (!viewer) return bad('Sign in first', 401);
    const { post, on } = body.data as { post?: unknown; on?: unknown };
    if (!isValidSignature(post)) return bad('Not a post id');
    const sql = getSql();
    if (on) await sql`insert into bookmarks (profile, post) values (${viewer}, ${post}) on conflict do nothing`;
    else await sql`delete from bookmarks where profile = ${viewer} and post = ${post}`;
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
