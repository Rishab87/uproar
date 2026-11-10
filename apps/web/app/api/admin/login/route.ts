import { checkRateLimit } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { adminLoginMessage, newNonce, setAdminCookie, verifyWalletMessage } from '@/lib/server/auth';
import { getSql } from '@/lib/server/db';
import { env } from '@/lib/server/env';
import { bad, failure, json, logRequest, rateKey, readBody, sameOrigin } from '@/lib/server/http';

/** Two steps: get a one-time message, then sign it with an operator wallet. */
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return bad('Not allowed', 403);
    if (!env.adminSecret || (env.adminWallets.length === 0 && !env.localDev)) return bad('The console is not configured', 503);
    const body = await readBody(req, 2048);
    if (body instanceof Response) return body;
    const sql = getSql();
    if (!(await checkRateLimit(sql, `admin:${rateKey(req)}`, 30, 600))) return bad('Too many attempts. Wait a few minutes.', 429);
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
    const { step, wallet, nonce, signature } = body.data as Record<string, string>;

    if (step === 'nonce') {
      const fresh = newNonce();
      await sql`insert into admin_logins (nonce) values (${fresh})`;
      return json({ nonce: fresh, message: adminLoginMessage(fresh, host) });
    }

    if (!wallet || !nonce || !signature) return bad('Incomplete sign-in');
    const claimed = await sql`
      update admin_logins set used_at = now()
      where nonce = ${nonce} and used_at is null and created_at > now() - interval '5 minutes'
      returning nonce`;
    if (claimed.length === 0) return bad('This sign-in expired. Try again.', 401);
    const ok = await verifyWalletMessage(wallet, adminLoginMessage(nonce, host), Buffer.from(signature, 'base64'));
    if (!ok) {
      await logRequest(req, 401);
      return bad('That signature is not valid', 401);
    }
    // Only someone holding the wallet's key learns whether it is an operator.
    if (!env.isOperator(wallet)) {
      await logRequest(req, 403);
      return bad('This wallet is not an operator', 403);
    }
    await setAdminCookie(wallet);
    await logRequest(req, 200);
    return json({ ok: true, wallet });
  } catch (error) {
    return failure(error);
  }
}
