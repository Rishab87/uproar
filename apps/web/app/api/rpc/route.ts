import { getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { RpcError } from '@uproar/indexer-core';
import { UPROAR_PROGRAM_ADDRESS } from '@uproar/protocol';
import type { NextRequest } from 'next/server';
import { getRpc } from '@/lib/server/db';
import { env } from '@/lib/server/env';
import { bad, clientIp, readBody } from '@/lib/server/http';

/**
 * The browser's only route to the chain. The allowlist is deliberately small. In particular
 * getTransaction isn't on it, so this domain never serves the text of a hidden post from the ledger.
 */
const ALLOWED = new Set([
  'getLatestBlockhash',
  'sendTransaction',
  'getSignatureStatuses',
  'getBalance',
  'getAccountInfo',
  'getMultipleAccounts',
  'getMinimumBalanceForRentExemption',
  'getRecentPrioritizationFees',
  'getBlockHeight',
]);
const TEST_CLUSTER_ONLY = new Set(['requestAirdrop']);

const SENDABLE_PROGRAMS = new Set<string>([UPROAR_PROGRAM_ADDRESS, 'ComputeBudget111111111111111111111111111111']);

/** This endpoint relays only UPROAR transactions, so nobody can use it as a free relay for anything else. */
function onlyUproar(wire: unknown): boolean {
  if (typeof wire !== 'string' || wire.length > 2_000) return false;
  try {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    // The app builds legacy and v0 messages only. Anything else isn't ours.
    if (!('instructions' in message)) return false;
    const instructions = message.instructions as readonly { programAddressIndex: number }[];
    return instructions.length > 0 && instructions.every((ix) => SENDABLE_PROGRAMS.has(message.staticAccounts[ix.programAddressIndex] as string));
  } catch {
    return false;
  }
}

const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 240;
const SENDS_PER_WINDOW = 40;
const buckets = new Map<string, { resetAt: number; total: number; sends: number }>();

/** A per-instance limiter. It's fast and needs no database on the hot path. */
function allow(ip: string, method: string): boolean {
  const now = Date.now();
  if (buckets.size > 20_000) {
    for (const [key, value] of buckets) if (value.resetAt < now) buckets.delete(key);
  }
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { resetAt: now + WINDOW_MS, total: 0, sends: 0 };
    buckets.set(ip, bucket);
  }
  bucket.total += 1;
  if (method === 'sendTransaction' || method === 'requestAirdrop') bucket.sends += 1;
  return bucket.total <= LIMIT_PER_WINDOW && bucket.sends <= SENDS_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  const body = await readBody(req, 6_000);
  if (body instanceof Response) return body;
  const { id, method, params } = body.data as { id?: unknown; method?: unknown; params?: unknown };
  const error = (code: number, message: string, status = 200) =>
    Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });

  if (typeof method !== 'string' || !Array.isArray(params)) return bad('Not a JSON-RPC request');
  const allowed = ALLOWED.has(method) || (TEST_CLUSTER_ONLY.has(method) && env.cluster !== 'mainnet-beta');
  if (!allowed) return error(-32601, `${method} is not available through this endpoint`, 403);
  if (!allow(clientIp(req), method)) return error(429, 'Too many requests', 429);
  if (method === 'sendTransaction' && !onlyUproar(params[0])) return error(-32602, 'Only UPROAR transactions can be sent through this endpoint', 403);
  if ((method === 'getMultipleAccounts' && Array.isArray(params[0]) && params[0].length > 20) || (method === 'getSignatureStatuses' && Array.isArray(params[0]) && params[0].length > 50)) {
    return error(-32602, 'Too many items in one request');
  }

  try {
    const result = await getRpc().call(method, params);
    return Response.json({ jsonrpc: '2.0', id: id ?? null, result }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof RpcError && e.code !== undefined) return error(e.code, e.message);
    console.error('rpc proxy failed', e);
    return error(-32000, 'The network is busy. Please try again.', 502);
  }
}
