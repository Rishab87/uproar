import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin';
import { getSql } from '@/lib/server/db';
import { bad, failure, json, logRequest } from '@/lib/server/http';

/**
 * Collects what this app holds about a subject, to answer a verified data request. It's a read of
 * what exists, and the audit log records that it was run.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const subject = (new URL(req.url).searchParams.get('subject') ?? '').trim().replace(/^@/, '');
    if (!subject) return bad('Name a handle, wallet or profile address');
    const sql = getSql();
    const profile = (await sql`
      select * from profiles where address = ${subject} or handle = ${subject.toLowerCase()} or authority = ${subject} or creator = ${subject} limit 1`)[0];
    if (!profile) return bad('No profile matches that', 404);
    const address = profile.address as string;
    const [sessions, access, consents, posts, reports] = await Promise.all([
      sql`select * from sessions where profile = ${address}`,
      sql`select at, method, route, status, ip, user_agent, country from access_log where profile = ${address} order by at desc limit 5000`,
      sql`select * from consents where profile = ${address}`,
      sql`select sig, text, reply_to, quote_of, slot, block_time, deleted from posts where author = ${address} order by slot desc limit 5000`,
      sql`select ref, category, created_at, status, decision from reports where target = ${address} or target in (select sig from posts where author = ${address})`,
    ]);
    await logRequest(req, 200, address);
    return json({ generatedAt: new Date().toISOString(), generatedBy: auth.admin, profile, sessions, consents, accessLog: access, posts, reportsAboutThisAccount: reports });
  } catch (error) {
    return failure(error);
  }
}
