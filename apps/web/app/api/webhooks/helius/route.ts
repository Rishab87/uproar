import { timingSafeEqual } from 'node:crypto';
import { ingestSignature } from '@uproar/indexer-core';
import { UPROAR_PROGRAM_ADDRESS } from '@uproar/protocol';
import type { NextRequest } from 'next/server';
import { getRpc, getSql } from '@/lib/server/db';
import { env } from '@/lib/server/env';
import { bad, failure, isValidSignature, json, readBody } from '@/lib/server/http';

const MAX_PER_CALL = 100;
const CONCURRENCY = 4;

/**
 * A raw-transaction webhook, treated as a hint. Only the signatures are taken from the payload, and
 * each transaction is fetched again from the RPC node, so a leaked secret can't inject events.
 */
export async function POST(req: NextRequest) {
  const secret = env.webhookSecret;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  if (!secret || given.length !== Buffer.byteLength(secret) || !timingSafeEqual(given, Buffer.from(secret))) return bad('Not allowed', 401);
  try {
    const body = await readBody(req, 2_000_000);
    if (body instanceof Response) return body;
    const list = Array.isArray(body.data) ? (body.data as { transaction?: { signatures?: unknown[] } }[]) : [];
    const signatures = [...new Set(list.map((raw) => raw?.transaction?.signatures?.[0]).filter(isValidSignature))].slice(0, MAX_PER_CALL);
    const sql = getSql();
    const rpc = getRpc();
    let indexed = 0;
    for (let i = 0; i < signatures.length; i += CONCURRENCY) {
      const results = await Promise.all(
        signatures.slice(i, i + CONCURRENCY).map((sig) => ingestSignature(sql, rpc, UPROAR_PROGRAM_ADDRESS as string, sig, { attempts: 3, delayMs: 400 })),
      );
      indexed += results.filter((r) => r === 'indexed').length;
    }
    return json({ received: signatures.length, indexed });
  } catch (error) {
    return failure(error);
  }
}
