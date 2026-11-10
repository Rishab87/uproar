import { withdrawReport } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { bad, failure, json, logRequest, readBody } from '@/lib/server/http';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 1024);
    if (body instanceof Response) return body;
    const { ref, token } = body.data as { ref?: string; token?: string };
    const ok = await withdrawReport(getSql(), String(ref ?? ''), String(token ?? ''));
    await logRequest(req, ok ? 200 : 409);
    return ok ? json({ ok: true }) : bad('This report cannot be withdrawn', 409);
  } catch (error) {
    return failure(error);
  }
}
