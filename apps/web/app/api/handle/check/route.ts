import { address as toAddress } from '@solana/kit';
import { handleAddress, handleDeposit, isValidHandle, normalizeHandle } from '@uproar/protocol';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@uproar/safety';
import { getRpc, getSql } from '@/lib/server/db';
import { bad, failure, json, rateKey } from '@/lib/server/http';

/** Availability comes from the chain itself, which is the only thing that can really say. */
export async function GET(req: NextRequest) {
  try {
    const handle = normalizeHandle(new URL(req.url).searchParams.get('h') ?? '');
    if (!isValidHandle(handle)) return json({ handle, valid: false, available: false, deposit: null });
    if (!(await checkRateLimit(getSql(), `handle:${rateKey(req)}`, 120, 60))) return bad('Too many requests', 429);
    const account = await handleAddress(handle);
    const res = await getRpc().call<{ value: unknown | null }>('getAccountInfo', [toAddress(account), { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, commitment: 'confirmed' }]);
    return json({ handle, valid: true, available: res.value === null, deposit: handleDeposit(handle).toString() });
  } catch (error) {
    return failure(error);
  }
}
