import { verifyAuditChain } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin';
import { getRpc, getSql } from '@/lib/server/db';
import { env } from '@/lib/server/env';
import { failure, json } from '@/lib/server/http';
import { alertChannels, runMaintenance } from '@/lib/server/maintenance';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const sql = getSql();
    const [chain, last, counts, audit, slot] = await Promise.all([
      sql<{ key: string; value: string; updated_at: Date }[]>`select key, value, updated_at from chain_state`,
      sql<{ n: number; latest: string | null }[]>`select count(*)::int as n, max(slot)::text as latest from events`,
      sql<{ unfinalized: number }[]>`select count(*)::int as unfinalized from events where not finalized`,
      verifyAuditChain(sql),
      getRpc().getSlot('confirmed').catch(() => null),
    ]);
    return json({
      alarms: { telegram: Boolean(env.telegram), email: Boolean(env.email), configured: alertChannels().length > 0 },
      cron: Boolean(env.cronSecret),
      cluster: env.cluster,
      chainState: chain,
      events: last[0],
      unfinalized: counts[0]?.unfinalized ?? 0,
      chainSlot: slot,
      audit,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    return json(await runMaintenance({ budgetMs: 30_000 }));
  } catch (error) {
    return failure(error);
  }
}
