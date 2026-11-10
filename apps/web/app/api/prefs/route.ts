import { LABELS } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { verifiedViewer } from '@/lib/server/auth';
import { routeCtx } from '@/lib/server/ctx';
import { bad, failure, isValidAddress, json, readBody } from '@/lib/server/http';
import { preferences } from '@/lib/server/queries';

const MAX_WORD = 64;
const MAX_WORDS = 200;

export async function GET(req: NextRequest) {
  try {
    const c = await routeCtx(req);
    if (!c.viewer) return bad('Sign in first', 401);
    return json(await preferences(c, c.viewer));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req, 2048);
    if (body instanceof Response) return body;
    const viewer = await verifiedViewer(req, body.raw);
    if (!viewer) return bad('Sign in first', 401);
    const { op, target, word, label, action } = body.data as Record<string, unknown>;
    const sql = getSql();
    switch (op) {
      case 'mute':
      case 'unmute':
      case 'block':
      case 'unblock': {
        if (!isValidAddress(target)) return bad('Not an account');
        if (target === viewer) return bad('That is you');
        if (op === 'mute') await sql`insert into mutes (profile, target) values (${viewer}, ${target}) on conflict do nothing`;
        if (op === 'unmute') await sql`delete from mutes where profile = ${viewer} and target = ${target}`;
        if (op === 'block') await sql`insert into blocks (profile, target) values (${viewer}, ${target}) on conflict do nothing`;
        if (op === 'unblock') await sql`delete from blocks where profile = ${viewer} and target = ${target}`;
        break;
      }
      case 'word_add': {
        const clean = typeof word === 'string' ? word.trim().toLowerCase() : '';
        if (!clean || clean.length > MAX_WORD) return bad(`Words can be 1 to ${MAX_WORD} characters`);
        const count = (await sql<{ n: number }[]>`select count(*)::int as n from muted_words where profile = ${viewer}`)[0]?.n ?? 0;
        if (count >= MAX_WORDS) return bad('You have reached the limit of muted words');
        await sql`insert into muted_words (profile, word) values (${viewer}, ${clean}) on conflict do nothing`;
        break;
      }
      case 'word_remove':
        if (typeof word !== 'string') return bad('Which word?');
        await sql`delete from muted_words where profile = ${viewer} and word = ${word}`;
        break;
      case 'label':
        if (typeof label !== 'string' || !LABELS[label] || !['hide', 'warn', 'show'].includes(String(action))) return bad('Unknown label setting');
        await sql`
          insert into label_prefs (profile, label, action) values (${viewer}, ${label}, ${String(action)})
          on conflict (profile, label) do update set action = excluded.action`;
        break;
      default:
        return bad('Unknown setting');
    }
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
