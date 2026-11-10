import { address as toAddress } from '@solana/kit';
import { getProfileDecoder, profileAddress } from '@uproar/protocol';
import type { NextRequest } from 'next/server';
import { getRpc, getSql } from '@/lib/server/db';
import { checkRateLimit } from '@uproar/safety';
import { bad, failure, isValidAddress, json, rateKey, viewerCountry } from '@/lib/server/http';
import { profilesOfWallet } from '@/lib/server/queries';

const decodeProfile = getProfileDecoder();

/** Finds the profile a wallet controls. A brand-new profile may not be indexed yet, so the chain backs it up. */
export async function GET(req: NextRequest) {
  try {
    const wallet = new URL(req.url).searchParams.get('wallet');
    if (!isValidAddress(wallet)) return bad('Not a wallet address');
    const c = { sql: getSql(), country: viewerCountry(req.headers), viewer: null };
    const profiles = await profilesOfWallet(c, wallet);
    if (profiles.length) return json({ profiles, pending: null });
    if (!(await checkRateLimit(c.sql, `me-chain:${rateKey(req)}`, 120, 60))) return bad('Too many requests', 429);

    const address = await profileAddress(toAddress(wallet));
    const res = await getRpc().call<{ value: { data: [string, string] } | null }>('getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!res.value) return json({ profiles: [], pending: null });
    const onChain = decodeProfile.decode(Buffer.from(res.value.data[0], 'base64'));
    if (onChain.authority !== wallet) return json({ profiles: [], pending: null });
    const handle = Buffer.from(onChain.handle as Uint8Array).subarray(0, onChain.handleLen).toString('utf8');
    return json({ profiles: [], pending: { address, handle: handle || null } });
  } catch (error) {
    return failure(error);
  }
}
