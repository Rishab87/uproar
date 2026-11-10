import { ipBucket, logAccess, SafetyError } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { getSql } from './db';
import { env } from './env';

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export const bad = (message: string, status = 400) => json({ error: message }, { status });

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

/** The key for rate limits: the address, or its /64 for IPv6. */
export function rateKey(req: NextRequest): string {
  return ipBucket(clientIp(req));
}

export function viewerCountry(headers: Headers): string {
  const country = headers.get('x-vercel-ip-country')?.toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : env.defaultCountry;
}

/** Reads a JSON body with a hard size limit, so a huge request can't tie up a function. */
export async function readBody(req: NextRequest, maxBytes = 16_384): Promise<{ raw: string; data: unknown } | Response> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return bad('That request is too large', 413);
  const raw = await req.text();
  if (raw.length > maxBytes) return bad('That request is too large', 413);
  try {
    return { raw, data: raw ? JSON.parse(raw) : {} };
  } catch {
    return bad('That request could not be read');
  }
}

export function isValidSignature(sig: unknown): sig is string {
  return typeof sig === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig);
}

export function isValidAddress(address: unknown): address is string {
  return typeof address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

/** Records write and safety endpoints for the rolling 180-day log that CERT-In directions require. */
export async function logRequest(req: NextRequest, status: number, profile?: string | null): Promise<void> {
  try {
    await logAccess(getSql(), {
      method: req.method,
      route: new URL(req.url).pathname,
      status,
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      country: req.headers.get('x-vercel-ip-country'),
      profile: profile ?? null,
    });
  } catch (error) {
    console.error('access log failed', error);
  }
}

/** Turns a handler's error into a response. Only SafetyError messages are shown to people. */
export function failure(error: unknown): Response {
  if (error instanceof SafetyError) return bad(error.message, 422);
  console.error(error);
  return bad('Something went wrong on our side. Please try again.', 500);
}

/** A same-origin check for endpoints that rely on a cookie. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
