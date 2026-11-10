import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './db';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

/**
 * Applies new SQL files in name order. Each file runs once, inside a transaction. This lives in its
 * own entry point because the web app bundles the rest of this package and never migrates.
 */
export async function migrate(sql: Sql, directory: string = MIGRATIONS): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = readdirSync(directory).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const text = readFileSync(join(directory, file), 'utf8');
    await sql.begin(async (t) => {
      await t.unsafe(text);
      await t`insert into schema_migrations (name) values (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
