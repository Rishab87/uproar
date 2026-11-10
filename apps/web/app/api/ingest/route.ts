import { ingestSignature } from '@uproar/indexer-core';
import { UPROAR_PROGRAM_ADDRESS } from '@uproar/protocol';
import { checkRateLimit } from '@uproar/safety';
import { after, type NextRequest } from 'next/server';
import { getRpc, getSql } from '@/lib/server/db';
import { bad, failure, isValidSignature, json, logRequest, rateKey, readBody } from '@/lib/server/http';
import { maybeRunMaintenance } from '@/lib/server/maintenance';

/**
 * A hint that a transaction just landed. It's only a hint: everything recorded comes from the RPC
 * node, so calling this can't forge an event or change a real one.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 512);
    if (body instanceof Response) return body;
    const { signature } = body.data as { signature?: unknown };
    if (!isValidSignature(signature)) return bad('Not a signature');
    const sql = getSql();
    // Per address, generous enough for many people behind one carrier NAT, plus a global cap on RPC
    // spend. Past either, the reconcile job picks the transaction up within a minute anyway.
    if (!(await checkRateLimit(sql, `ingest:${rateKey(req)}`, 120, 60))) return bad('Too many requests', 429);
    if (!(await checkRateLimit(sql, 'ingest:global', 1_200, 60))) return json({ result: 'queued' }, { status: 202 });
    const result = await ingestSignature(sql, getRpc(), UPROAR_PROGRAM_ADDRESS as string, signature, { attempts: 4, delayMs: 500 });
    after(() => Promise.all([logRequest(req, 200), maybeRunMaintenance()]));
    return json({ result });
  } catch (error) {
    return failure(error);
  }
}
