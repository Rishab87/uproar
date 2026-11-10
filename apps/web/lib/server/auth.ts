import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { address as toAddress, getBase58Encoder, getPublicKeyFromAddress, signatureBytes, verifySignature } from '@solana/kit';
import { UPROAR_PROGRAM_ADDRESS, getProfileDecoder, getSessionDecoder, sessionAddress } from '@uproar/protocol';
import { checkRateLimit } from '@uproar/safety';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { AUTH_HEADER, AUTH_MAX_SKEW_SECONDS, authMessage, sha256Hex } from '../shared/auth';
import { getRpc, getSql } from './db';
import { env } from './env';
import { isValidAddress, rateKey } from './http';

const base58 = getBase58Encoder();

/**
 * Verifies a signed private request. The signer must be the profile's owner or a live delegate.
 * The indexed state answers first. If the session is too new to be indexed, the chain decides.
 */
export async function verifiedViewer(req: NextRequest, rawBody = ''): Promise<string | null> {
  const header = req.headers.get(AUTH_HEADER);
  if (!header) return null;
  const [version, profile, signer, ts, sig] = header.split('.');
  if (version !== 'v1' || !isValidAddress(profile) || !isValidAddress(signer) || !ts || !sig) return null;
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > AUTH_MAX_SKEW_SECONDS) return null;

  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const message = authMessage({ host, method: req.method, path: url.pathname + url.search, profile, timestamp, bodyHash: await sha256Hex(rawBody) });
  try {
    const key = await getPublicKeyFromAddress(toAddress(signer));
    const ok = await verifySignature(key, signatureBytes(base58.encode(sig) as Uint8Array), message);
    if (!ok) return null;
  } catch {
    return null;
  }
  return (await isAuthorized(profile, signer, rateKey(req))) ? profile : null;
}

async function isAuthorized(profile: string, signer: string, clientKey: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql<{ ok: boolean }[]>`
    select (
      exists (select 1 from profiles p where p.address = ${profile} and p.authority = ${signer} and not p.closed)
      or exists (
        select 1 from sessions s join profiles pr on pr.address = s.profile
        where s.profile = ${profile} and s.delegate = ${signer} and not s.closed and s.expires_at > now() and not pr.closed
          and (pr.kill_slot is null or (pr.kill_slot, pr.kill_sig, pr.kill_ix) < (s.version_slot, s.version_sig, s.version_ix))
      )
    ) as ok`;
  if (rows[0]?.ok) return true;
  // The chain is asked only when the index hasn't caught up yet. Anyone can trigger this path with a
  // self-made key, so it's rate limited.
  if (!(await checkRateLimit(sql, `authchain:${clientKey}`, 120, 60))) return false;
  return isAuthorizedOnChain(profile, signer);
}

const decodeProfile = getProfileDecoder();
const decodeSession = getSessionDecoder();

async function isAuthorizedOnChain(profile: string, signer: string): Promise<boolean> {
  try {
    const session = await sessionAddress(toAddress(profile), toAddress(signer));
    const res = await getRpc().call<{ value: ({ data: [string, string]; owner: string } | null)[] }>('getMultipleAccounts', [
      [profile, session],
      { encoding: 'base64', commitment: 'confirmed' },
    ]);
    const [p, s] = res.value;
    const ours = (a: { data: [string, string]; owner: string } | null | undefined, discriminator: number) =>
      a && a.owner === UPROAR_PROGRAM_ADDRESS && Buffer.from(a.data[0], 'base64')[0] === discriminator ? Buffer.from(a.data[0], 'base64') : null;
    const profileData = ours(p, 1);
    if (!profileData) return false;
    const owner = decodeProfile.decode(profileData);
    if (owner.authority === signer) return true;
    const sessionData = ours(s, 3);
    if (!sessionData) return false;
    const live = decodeSession.decode(sessionData);
    return live.profile === profile && live.delegate === signer && live.epoch === owner.sessionEpoch && Number(live.expiresAt) > Date.now() / 1000;
  } catch {
    return false;
  }
}

// ---- operator console ------------------------------------------------------------------------

const ADMIN_COOKIE = 'uproar_admin';
const ADMIN_TTL_SECONDS = 8 * 3600;

function adminSignature(wallet: string, expires: number): string {
  return createHmac('sha256', env.adminSecret).update(`${wallet}.${expires}`).digest('base64url');
}

export function adminLoginMessage(nonce: string, host: string): string {
  return `Sign in to the UPROAR operator console.\n\nHost: ${host}\nNonce: ${nonce}\n\nThis signs nothing on chain and costs nothing.`;
}

export const newNonce = () => randomBytes(18).toString('base64url');

export async function verifyWalletMessage(wallet: string, message: string, signature: Uint8Array): Promise<boolean> {
  try {
    const key = await getPublicKeyFromAddress(toAddress(wallet));
    return await verifySignature(key, signatureBytes(signature), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

export async function setAdminCookie(wallet: string): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_TTL_SECONDS;
  (await cookies()).set(ADMIN_COOKIE, `${wallet}.${expires}.${adminSignature(wallet, expires)}`, {
    httpOnly: true,
    secure: env.siteUrl.startsWith('https://'),
    sameSite: 'strict',
    path: '/',
    maxAge: ADMIN_TTL_SECONDS,
  });
}

export async function clearAdminCookie(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

/** The wallet behind a valid operator cookie, or null. Removing a wallet from the list ends its access. */
export async function currentAdmin(): Promise<string | null> {
  if (!env.adminSecret) return null;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!value) return null;
  const [wallet, expires, signature] = value.split('.');
  if (!wallet || !expires || !signature) return null;
  if (Number(expires) < Date.now() / 1000) return null;
  const expected = Buffer.from(adminSignature(wallet, Number(expires)));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return env.isOperator(wallet) ? wallet : null;
}
