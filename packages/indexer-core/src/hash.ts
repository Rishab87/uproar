import { createHash } from 'node:crypto';
import type { Sql } from './db';

const TABLES: { name: string; order: string; drop?: string[] }[] = [
  { name: 'events', order: 'sig, ix_index', drop: ['finalized'] },
  { name: 'profiles', order: 'address' },
  { name: 'handles', order: 'address' },
  { name: 'posts', order: 'sig', drop: ['search'] },
  { name: 'post_deletes', order: 'post, profile' },
  { name: 'likes', order: 'profile, post' },
  { name: 'reposts', order: 'profile, post' },
  { name: 'follows', order: 'follower, followee' },
  { name: 'post_tags', order: 'post, tag' },
  { name: 'post_mentions', order: 'post, handle' },
  { name: 'sessions', order: 'address' },
];

/**
 * A SHA-256 over every chain-derived row in a fixed order. Two indexers with the same hash hold the
 * same state, whatever machine they run on and whatever order they received events in.
 */
export async function stateHash(sql: Sql): Promise<string> {
  const hash = createHash('sha256');
  await sql.begin(async (t) => {
    await t`set local time zone 'UTC'`;
    await t`set transaction read only`.catch(() => {});
    for (const { name, order, drop } of TABLES) {
      hash.update(`${name}\n`);
      const without = (drop ?? []).map((d) => ` - '${d}'`).join('');
      const rows = await t.unsafe<{ row: string }[]>(`select (to_jsonb(t)${without})::text as row from ${name} t order by ${order}`);
      for (const { row } of rows) hash.update(`${row}\n`);
    }
  });
  return hash.digest('hex');
}
