import { checkRateLimit, dispatchAlerts, fileOrder } from '@uproar/safety';
import { after, type NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { bad, clientIp, failure, json, logRequest, rateKey, readBody } from '@/lib/server/http';
import { alertChannels } from '@/lib/server/maintenance';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 16_384);
    if (body instanceof Response) return body;
    const sql = getSql();
    const ip = clientIp(req);
    if (!(await checkRateLimit(sql, `order:${rateKey(req)}`, 12, 3600))) return bad(`Too many submissions from here. Please email the Grievance Officer.`, 429);
    const d = body.data as Record<string, unknown>;
    const targets = Array.isArray(d.targets) ? d.targets : [];
    const filed = await fileOrder(sql, {
      kind: d.kind === 'court' ? 'court' : d.kind === 'police' ? 'police' : 'government',
      authority: String(d.authority ?? ''),
      officerName: String(d.officerName ?? ''),
      officerDesignation: String(d.officerDesignation ?? ''),
      orderReference: String(d.orderReference ?? ''),
      contactEmail: String(d.contactEmail ?? ''),
      targets: targets.slice(0, 200).map((t: { type?: unknown; target?: unknown }) => ({ type: (t.type === 'profile' ? 'profile' : 'post') as 'post' | 'profile', target: String(t.target ?? '') })).filter((t) => t.target),
      scopeCountries: Array.isArray(d.scopeCountries) ? d.scopeCountries.map(String).filter((c) => /^[A-Za-z]{2}$/.test(c)) : [],
      ...(typeof d.documentUrl === 'string' && /^https?:\/\//.test(d.documentUrl) ? { documentUrl: d.documentUrl.slice(0, 500) } : {}),
      details: String(d.details ?? '').slice(0, 4_000),
      ip,
    });
    after(() => Promise.all([logRequest(req, 200), dispatchAlerts(sql, alertChannels())]));
    return json(filed);
  } catch (error) {
    return failure(error);
  }
}
