import { checkRateLimit, dispatchAlerts, fileReport } from '@uproar/safety';
import { after, type NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { bad, clientIp, failure, json, logRequest, rateKey, readBody, viewerCountry } from '@/lib/server/http';
import { alertChannels } from '@/lib/server/maintenance';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 8_192);
    if (body instanceof Response) return body;
    const sql = getSql();
    const ip = clientIp(req);
    if (!(await checkRateLimit(sql, `report:${rateKey(req)}`, 12, 3600))) return bad('Too many reports from here. Please try again later, or email the Grievance Officer.', 429);
    const d = body.data as Record<string, unknown>;
    const filed = await fileReport(sql, {
      targetType: d.targetType === 'profile' ? 'profile' : 'post',
      target: String(d.target ?? ''),
      category: String(d.category ?? ''),
      details: String(d.details ?? ''),
      name: typeof d.name === 'string' ? d.name.slice(0, 200) : undefined,
      email: typeof d.email === 'string' ? d.email.slice(0, 200) : undefined,
      onBehalf: Boolean(d.onBehalf),
      declaration: Boolean(d.declaration),
      ip,
      country: viewerCountry(req.headers),
    } as Parameters<typeof fileReport>[1]);
    after(() => Promise.all([logRequest(req, 200), dispatchAlerts(sql, alertChannels())]));
    return json(filed);
  } catch (error) {
    return failure(error);
  }
}
