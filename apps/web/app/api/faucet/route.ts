import { isAddress } from '@solana/kit';
import { after, type NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { env } from '@/lib/server/env';
import { drip, type DripResult } from '@/lib/server/faucet';
import { bad, failure, json, logRequest, rateKey, readBody } from '@/lib/server/http';

const STATUS: Record<DripResult['status'], number> = { sent: 200, not_needed: 200, already_sent: 409, limited: 429, dry: 503, unavailable: 503, failed: 502 };

/** Test SOL for a new wallet, so a name can be claimed without hunting for a faucet. Never on mainnet. */
export async function POST(req: NextRequest) {
  if (env.cluster === 'mainnet-beta') return bad('Not found', 404);
  try {
    const body = await readBody(req, 512);
    if (body instanceof Response) return body;
    const wallet = (body.data as { address?: unknown }).address;
    if (typeof wallet !== 'string' || !isAddress(wallet)) return bad('That is not a wallet address');
    const result = await drip(getSql(), wallet, rateKey(req));
    const status = STATUS[result.status];
    after(() => logRequest(req, status));
    return json(result, { status });
  } catch (error) {
    return failure(error);
  }
}
