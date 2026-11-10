import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { getSql } from './db';
import { verifiedViewer } from './auth';
import { viewerCountry } from './http';
import type { Ctx } from './queries';

/** Query context for a route handler: the verified viewer, if the request is signed. */
export async function routeCtx(req: NextRequest, rawBody = ''): Promise<Ctx> {
  return { sql: getSql(), country: viewerCountry(req.headers), viewer: await verifiedViewer(req, rawBody) };
}

/** Query context for a server component. Server rendering is always the anonymous view. */
export async function pageCtx(): Promise<Ctx> {
  return { sql: getSql(), country: viewerCountry(await headers()), viewer: null };
}
