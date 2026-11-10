import { hide, label, unhide, unlabel, unwithhold, withhold, type ActionInput } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin';
import { getSql } from '@/lib/server/db';
import { bad, failure, json, logRequest, readBody } from '@/lib/server/http';

/** Direct operator actions outside a queue item. Each needs a reason and lands in the public log. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await readBody(req, 4_096);
    if (body instanceof Response) return body;
    const d = body.data as Record<string, unknown>;
    const note = String(d.note ?? '').trim();
    if (!note) return bad('Write a reason');
    const target = String(d.target ?? '').trim();
    if (!target) return bad('Name a post ID or account address');
    const base: ActionInput = {
      targetType: d.targetType === 'profile' ? 'profile' : 'post',
      target,
      reasonCode: String(d.reasonCode ?? 'operator_review'),
      actor: auth.admin,
      note,
      publishTarget: d.publishTarget !== false,
      ...(typeof d.publicNote === 'string' && d.publicNote ? { publicNote: d.publicNote } : {}),
      ...(typeof d.legalBasis === 'string' && d.legalBasis ? { legalBasis: d.legalBasis } : {}),
    };
    const countries = Array.isArray(d.countries) ? d.countries.map(String) : [];
    const sql = getSql();
    switch (d.op) {
      case 'hide': await hide(sql, base); break;
      case 'unhide': await unhide(sql, base); break;
      case 'withhold': await withhold(sql, { ...base, countries }); break;
      case 'unwithhold': await unwithhold(sql, { ...base, countries }); break;
      case 'label': await label(sql, { ...base, label: String(d.label ?? '') }); break;
      case 'unlabel': await unlabel(sql, { ...base, label: String(d.label ?? '') }); break;
      default: return bad('Unknown action');
    }
    await logRequest(req, 200);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
