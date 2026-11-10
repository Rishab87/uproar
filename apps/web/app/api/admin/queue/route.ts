import { activeOrders, queue } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin';
import { getSql } from '@/lib/server/db';
import { failure, json } from '@/lib/server/http';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const sql = getSql();
    const [items, alerts, orders] = await Promise.all([
      queue(sql),
      sql`select id, severity, kind, subject, body, created_at, due_at, send_count, last_sent_at, last_error from alerts where acknowledged_at is null order by severity, created_at limit 100`,
      activeOrders(sql),
    ]);
    return json({ admin: auth.admin, items, alerts, orders });
  } catch (error) {
    return failure(error);
  }
}
