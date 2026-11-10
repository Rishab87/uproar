import { decideAppeal, decideOrder, decideReport, liftOrder, respondToDataRequest, type ReportDecision } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin';
import { getSql } from '@/lib/server/db';
import { bad, failure, json, logRequest, readBody } from '@/lib/server/http';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await readBody(req, 8_192);
    if (body instanceof Response) return body;
    const d = body.data as Record<string, unknown>;
    const ref = String(d.ref ?? '');
    const sql = getSql();
    const actor = auth.admin;
    switch (d.kind) {
      case 'report':
        await decideReport(sql, ref, {
          decision: String(d.decision) as ReportDecision['decision'],
          reason: String(d.reason ?? ''),
          actor,
          falseReport: Boolean(d.falseReport),
          ...(Array.isArray(d.countries) ? { countries: d.countries.map(String) } : {}),
          ...(typeof d.label === 'string' ? { label: d.label } : {}),
          ...(typeof d.externalReportRef === 'string' && d.externalReportRef ? { externalReportRef: d.externalReportRef } : {}),
          ...(typeof d.publicNote === 'string' && d.publicNote ? { publicNote: d.publicNote } : {}),
        });
        break;
      case 'order':
        await decideOrder(sql, ref, { status: String(d.status) as 'actioned' | 'rejected' | 'challenged', note: String(d.note ?? ''), actor, ...(typeof d.publish === 'boolean' ? { publish: d.publish } : {}) });
        break;
      case 'order_lift':
        await liftOrder(sql, ref, { note: String(d.note ?? ''), actor });
        break;
      case 'data_request':
        await respondToDataRequest(sql, ref, { status: String(d.status) as 'responded' | 'rejected', note: String(d.note ?? ''), actor });
        break;
      case 'appeal':
        await decideAppeal(sql, ref, { status: String(d.status) as 'upheld' | 'overturned', note: String(d.note ?? ''), actor });
        break;
      default:
        return bad('Unknown item');
    }
    await logRequest(req, 200);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
