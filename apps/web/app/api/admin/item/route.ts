import { showState } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin';
import { getSql } from '@/lib/server/db';
import { bad, failure, json } from '@/lib/server/http';

/**
 * Full details of a queue item. It's the one place that reads the original text of a hidden post,
 * because reviewing a report needs it, and it sits behind the operator check.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get('kind');
    const ref = searchParams.get('ref') ?? '';
    const sql = getSql();
    let row: Record<string, unknown> | undefined;
    if (kind === 'report') row = (await sql`select * from reports where ref = ${ref}`)[0];
    else if (kind === 'order') row = (await sql`select * from legal_orders where ref = ${ref}`)[0];
    else if (kind === 'data_request') row = (await sql`select * from data_requests where ref = ${ref}`)[0];
    else if (kind === 'appeal') row = (await sql`select * from appeals where ref = ${ref}`)[0];
    if (!row) return bad('Not found', 404);

    const targets: { type: 'post' | 'profile'; target: string }[] = kind === 'order'
      ? ((row.targets as { type: 'post' | 'profile'; target: string }[]) ?? [])
      : row.target
        ? [{ type: row.target_type as 'post' | 'profile', target: row.target as string }]
        : [];
    const content = await Promise.all(
      targets.slice(0, 20).map(async (t) => {
        const state = await showState(sql, t.type, t.target);
        if (t.type === 'post') {
          const post = (await sql`select p.sig, p.text, p.block_time, p.deleted, a.handle, a.address from posts p join profiles a on a.address = p.author where p.sig = ${t.target}`)[0];
          return { ...t, state, post: post ?? null };
        }
        const profile = (await sql`select address, handle, name, bio, website, authority from profiles where address = ${t.target}`)[0];
        return { ...t, state, profile: profile ?? null };
      }),
    );
    const history = targets.length
      ? await sql`select at, actor, action, countries, label, reason_code, note from moderation_actions where target = any(${targets.map((t) => t.target)}) order by id desc limit 50`
      : [];
    return json({ item: row, content, history });
  } catch (error) {
    return failure(error);
  }
}
