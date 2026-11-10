import { checkRateLimit, dispatchAlerts, fileDataRequest } from '@uproar/safety';
import { after, type NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { bad, clientIp, failure, json, logRequest, rateKey, readBody } from '@/lib/server/http';
import { alertChannels } from '@/lib/server/maintenance';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 8_192);
    if (body instanceof Response) return body;
    const sql = getSql();
    const ip = clientIp(req);
    if (!(await checkRateLimit(sql, `data:${rateKey(req)}`, 12, 3600))) return bad('Too many submissions from here. Please email the Grievance Officer.', 429);
    const d = body.data as Record<string, unknown>;
    const filed = await fileDataRequest(sql, {
      authority: String(d.authority ?? ''),
      officerName: String(d.officerName ?? ''),
      officerDesignation: String(d.officerDesignation ?? ''),
      legalBasis: String(d.legalBasis ?? ''),
      contactEmail: String(d.contactEmail ?? ''),
      subject: String(d.subject ?? '').slice(0, 1_000),
      details: String(d.details ?? '').slice(0, 4_000),
      ip,
    });
    after(() => Promise.all([logRequest(req, 200), dispatchAlerts(sql, alertChannels())]));
    return json(filed);
  } catch (error) {
    return failure(error);
  }
}
