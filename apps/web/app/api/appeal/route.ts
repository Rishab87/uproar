import { appealStatus, checkRateLimit, dispatchAlerts, fileAppeal } from '@uproar/safety';
import { after, type NextRequest } from 'next/server';
import { verifiedViewer } from '@/lib/server/auth';
import { getSql } from '@/lib/server/db';
import { bad, clientIp, failure, json, logRequest, rateKey, readBody } from '@/lib/server/http';
import { alertChannels } from '@/lib/server/maintenance';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = await appealStatus(getSql(), searchParams.get('ref') ?? '', searchParams.get('token') ?? '');
    return status ? json(status) : bad('No appeal matches that reference and token', 404);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 8_192);
    if (body instanceof Response) return body;
    const sql = getSql();
    const ip = clientIp(req);
    if (!(await checkRateLimit(sql, `appeal:${rateKey(req)}`, 10, 3600))) return bad('Too many appeals from here. Please try again later.', 429);
    const d = body.data as Record<string, unknown>;
    const targetType = d.targetType === 'profile' ? 'profile' : 'post';
    const target = String(d.target ?? '');
    const viewer = await verifiedViewer(req, body.raw);
    let verifiedAuthor = false;
    if (viewer) {
      const rows = targetType === 'profile'
        ? await sql`select 1 from profiles where address = ${target} and address = ${viewer}`
        : await sql`select 1 from posts where sig = ${target} and author = ${viewer}`;
      verifiedAuthor = rows.length > 0;
    }
    const filed = await fileAppeal(sql, { targetType, target, email: String(d.email ?? ''), statement: String(d.statement ?? ''), verifiedAuthor, ip });
    after(() => Promise.all([logRequest(req, 200, viewer), dispatchAlerts(sql, alertChannels())]));
    return json(filed);
  } catch (error) {
    return failure(error);
  }
}
